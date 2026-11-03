// ============================================
// Face recognition helper (server-side)
// Uses face-api.js running on plain TensorFlow.js (CPU) + node-canvas
// so no GPU / paid API is required.
// ============================================

const path = require('path');
const { Canvas, Image, ImageData, loadImage } = require('canvas');
const faceapi = require('face-api.js');

// face-api.js expects browser globals (Image, Canvas, etc.) - patch them for Node
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODELS_PATH = path.join(__dirname, 'public', 'models');
let modelsReady = false;

async function loadModels() {
  if (modelsReady) return;
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
  modelsReady = true;
  console.log('Face recognition models loaded.');
}

// Detect every face in an image file and return their 128-d descriptors
async function getFaceDescriptors(imagePath) {
  const img = await loadImage(imagePath);
  const detections = await faceapi
    .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptors();
  return detections.map(d => Array.from(d.descriptor)); // plain JS arrays, JSON-safe
}

// Get a single descriptor from a guest selfie buffer (expects exactly one clear face)
async function getSelfieDescriptor(imageBuffer) {
  const img = await loadImage(imageBuffer);
  const detection = await faceapi
    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor);
}

// Euclidean distance between two descriptors - lower = more similar.
// face-api.js's own convention: ~0.6 is the typical match threshold.
function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

module.exports = {
  loadModels,
  getFaceDescriptors,
  getSelfieDescriptor,
  euclideanDistance,
  MATCH_THRESHOLD: 0.6
};
