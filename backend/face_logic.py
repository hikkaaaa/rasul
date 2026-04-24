import base64
import logging
import math
from dataclasses import dataclass
from typing import Any

import cv2
import face_recognition
import numpy as np

from config import settings

logger = logging.getLogger("face-logic")


class ImageValidationError(Exception):
    """Raised when an image is corrupt, has no face, or is too blurry."""


class LivenessError(Exception):
    """Raised when liveness checks (challenges) fail."""


@dataclass
class FrameAnalysis:
    """Consolidated analysis of a single video frame."""
    image_rgb: np.ndarray
    face_location: tuple[int, int, int, int]  # (top, right, bottom, left)
    landmarks: dict[str, list[tuple[int, int]]]
    embedding: list[float]
    blur_variance: float


def face_distance(face_encodings, face_to_compare) -> float:
    """
    Given a list of face encodings, compare them to a known face encoding 
    and get a euclidean distance for each comparison face.
    """
    if len(face_encodings) == 0:
        return np.empty((0))
    
    # We can handle both single embedding and list of embeddings
    enc1 = np.array(face_encodings)
    enc2 = np.array(face_to_compare)
    
    if enc1.ndim == 1:
        return float(np.linalg.norm(enc1 - enc2))
    return np.linalg.norm(enc1 - enc2, axis=1).tolist()


def analyze_frame(base64_image: str) -> FrameAnalysis:
    """
    Decodes a base64 image and performs full analysis:
    - Decoding and basic validation
    - Blur detection
    - Face detection (must be exactly one)
    - Facial landmarks extraction
    - Face embedding calculation
    """
    try:
        if "," in base64_image:
            base64_image = base64_image.split(",")[1]
        image_data = base64.b64decode(base64_image)
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ImageValidationError("Could not decode image")
    except Exception as e:
        raise ImageValidationError(f"Invalid image format: {e}")

    # 1. Quality check: Blur detection via Laplacian variance
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur_variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_variance < settings.min_face_blur_variance:
        logger.info("analyze.quality_fail blur_variance=%.2f", blur_variance)
        raise ImageValidationError("Image is too blurry (potential spoof or poor quality)")

    # 2. Face detection
    rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    face_locations = face_recognition.face_locations(rgb_img)
    
    if len(face_locations) == 0:
        raise ImageValidationError("No face detected in the image")
    if len(face_locations) > 1:
        raise ImageValidationError("Multiple faces detected - please ensure only you are in frame")

    face_location = face_locations[0]

    # 3. Landmarks and Embedding
    landmarks_list = face_recognition.face_landmarks(rgb_img, [face_location])
    if not landmarks_list:
        raise ImageValidationError("Could not identify facial landmarks")
    
    encodings = face_recognition.face_encodings(rgb_img, [face_location])
    if not encodings:
        raise ImageValidationError("Could not generate face embedding")

    return FrameAnalysis(
        image_rgb=rgb_img,
        face_location=face_location,
        landmarks=landmarks_list[0],
        embedding=encodings[0].tolist(),
        blur_variance=blur_variance
    )


def get_embedding(base64_image: str) -> list[float] | None:
    """Simplified version for login that only returns the embedding or None."""
    try:
        analysis = analyze_frame(base64_image)
        return analysis.embedding
    except (ImageValidationError, Exception):
        return None


def verify_challenge(analysis: FrameAnalysis, challenge: str):
    """
    Verifies that the face in the frame matches the requested challenge pose.
    Challenges: neutral, turn_left, turn_right, look_up, look_down, smile
    """
    lm = analysis.landmarks
    
    # 1. Basic pose estimation using eyes and nose
    # Average eye centers
    left_eye = np.mean(lm['left_eye'], axis=0)
    right_eye = np.mean(lm['right_eye'], axis=0)
    nose_tip = lm['nose_bridge'][-1]
    
    # Horizontal ratio: how far is nose from center of eyes?
    eye_dist = np.linalg.norm(left_eye - right_eye)
    eye_center = (left_eye + right_eye) / 2
    
    # Offset of nose tip from eye center
    h_offset = (nose_tip[0] - eye_center[0]) / eye_dist
    v_offset = (nose_tip[1] - eye_center[1]) / eye_dist

    if challenge == "neutral":
        if abs(h_offset) > 0.15:
            raise LivenessError("Please look directly at the camera")
        if abs(v_offset - 0.5) > 0.3: # Nose is normally ~0.5 eye-dist below center
             raise LivenessError("Please keep your head level")
             
    elif challenge == "turn_left":
        # Because the react-webcam captures the MIRRORED image, turning left 
        # means the nose points to the left side of the image frame (smaller X).
        if h_offset > -0.2:
            raise LivenessError("Please turn your head further to your left")
            
    elif challenge == "turn_right":
        # Turning right means the nose points to the right side of the mirrored image (larger X).
        if h_offset < 0.2:
            raise LivenessError("Please turn your head further to your right")
            
    elif challenge == "look_up":
        if v_offset > 0.4: # Nose tip moves UP (smaller Y)
            raise LivenessError("Please look higher up")
            
    elif challenge == "look_down":
        if v_offset < 0.7: # Nose tip moves DOWN (larger Y)
            raise LivenessError("Please look lower down")
            
    elif challenge == "smile":
        # Check mouth width relative to nose length OR mouth openness
        mouth_width = np.linalg.norm(np.array(lm['top_lip'][0]) - np.array(lm['top_lip'][6]))
        nose_length = np.linalg.norm(np.array(lm['nose_bridge'][0]) - np.array(lm['nose_bridge'][-1]))
        
        # Upper vs lower lip (inner) 
        if 'top_lip' in lm and 'bottom_lip' in lm:
            # Distance between the center of the outer top lip and outer bottom lip
            mouth_openness = np.linalg.norm(np.array(lm['top_lip'][3]) - np.array(lm['bottom_lip'][3]))
            # Either a wide smile or mouth is open enough. We use ratios to ensure it works at any scale.
            if (mouth_width / nose_length < 1.4) and (mouth_openness / nose_length < 0.35): 
                raise LivenessError("Please smile clearly or open your mouth")
        else:
            if mouth_width / nose_length < 1.4: 
                raise LivenessError("Please smile more clearly")


def ensure_same_person(analysis1: FrameAnalysis, analysis2: FrameAnalysis):
    """Rejects if the two frames appear to be different people."""
    dist = face_distance(analysis1.embedding, analysis2.embedding)
    # Using duplicate_face_distance as a strict threshold for consistency
    if dist > settings.face_tolerance:
        raise LivenessError(f"Identity drift detected (dist={dist:.3f}) - please stay in frame")