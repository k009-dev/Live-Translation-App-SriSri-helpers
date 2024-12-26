// Base API URL
export const API_BASE_URL = 'http://localhost:3001';

// API Endpoints
export const API_ENDPOINTS = {
  VALIDATE_YOUTUBE: `${API_BASE_URL}/api/validate-youtube`,
  EXTRACTION_STATUS: (videoId) => `${API_BASE_URL}/api/extraction-status/${videoId}`,
  AUDIO_STATUS: (videoId) => `${API_BASE_URL}/api/audio-status/${videoId}`,
  AUDIO_FRAGMENTS: (videoId, language) => `${API_BASE_URL}/api/audio/${videoId}/${language}/fragments`,
  SERVER_STATUS: `${API_BASE_URL}/api/status`
};

// Polling intervals (in milliseconds)
export const POLLING_INTERVALS = {
  EXTRACTION_STATUS: 2000,
  FRAGMENT_CHECK: 1000
};

// Toast notification durations (in milliseconds)
export const TOAST_DURATIONS = {
  SUCCESS: 4000,
  ERROR: 5000
}; 