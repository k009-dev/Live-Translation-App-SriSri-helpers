/**
 * Home page component for video URL input and validation
 * Purpose: Allows users to input YouTube URLs and start the processing
 * 
 * Flow:
 * 1. User inputs YouTube URL
 * 2. Validates URL and checks if it's a live stream
 * 3. Shows live stream modal if needed
 * 4. Starts processing and redirects to details page
 * 
 * Dependencies:
 * - LiveStreamModal for handling live streams
 * - Backend API for validation and processing
 * - React Router for navigation
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { LiveStreamModal } from '../../components/modals/LiveStreamModal';
import { API_ENDPOINTS, TOAST_DURATIONS } from '../../utils/constants';

export function Home() {
  // State management
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [pendingLiveUrl, setPendingLiveUrl] = useState(null);
  const navigate = useNavigate();

  /**
   * Handles live stream processing choice
   * @param {string} choice - 'beginning' or 'current'
   */
  const handleLiveStreamChoice = async (choice) => {
    setShowLiveModal(false);
    if (!pendingLiveUrl) return;

    setLoading(true);
    try {
      const response = await axios.post(API_ENDPOINTS.VALIDATE_YOUTUBE, { 
        url: pendingLiveUrl,
        liveStreamChoice: choice 
      });
      
      toast.success('Live stream processing started!', {
        duration: TOAST_DURATIONS.SUCCESS,
        icon: '🎥'
      });

      navigate(`/details/${response.data.id}`);
    } catch (error) {
      console.error('Error:', error);
      toast.error(error.response?.data?.error || 'Failed to process live stream', {
        duration: TOAST_DURATIONS.ERROR
      });
    } finally {
      setLoading(false);
      setPendingLiveUrl(null);
    }
  };

  /**
   * Extracts video ID from YouTube URL
   * @param {string} url - YouTube URL
   * @returns {string|null} Video ID or null if not found
   */
  const extractVideoId = (url) => {
    const match = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/user\/\S+|\/ytscreeningroom\?v=|\/sandalsResorts#\w\/\w\/.*\/))([^\/&\n?\s]{11})/);
    return match?.[1] || null;
  };

  /**
   * Validates YouTube URL and starts processing
   * @param {Event} e - Form submit event
   */
  const validateUrl = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Initial validation check
      const checkResponse = await axios.post(API_ENDPOINTS.VALIDATE_YOUTUBE, { 
        url,
        checkOnly: true 
      });

      // Handle live streams
      if (checkResponse.data.isLiveContent) {
        setPendingLiveUrl(url);
        setShowLiveModal(true);
        setLoading(false);
        return;
      }

      // Extract video ID
      const videoId = extractVideoId(url) || checkResponse.data.id;
      
      if (videoId) {
        // Start background processing
        axios.post(API_ENDPOINTS.VALIDATE_YOUTUBE, { url })
          .catch(error => {
            console.error('Background extraction error:', error);
          });

        // Navigate to details page
        navigate(`/details/${videoId}`);
        
        toast.success('Video validated and processing started!', {
          duration: TOAST_DURATIONS.SUCCESS,
          icon: '✅'
        });
      } else {
        toast.error('Could not process video. Invalid video ID.');
      }

    } catch (error) {
      handleValidationError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles validation errors with appropriate messages
   * @param {Error} error - Error object
   */
  const handleValidationError = (error) => {
    if (error.code === 'ERR_NETWORK') {
      toast.error('Cannot connect to server. Please make sure the backend is running.', {
        duration: TOAST_DURATIONS.ERROR
      });
    } else {
      const errorMessage = error.response?.data?.error || 'Failed to validate URL';
      toast.error(errorMessage, {
        duration: TOAST_DURATIONS.ERROR
      });
      
      if (error.response?.status === 403) {
        toast.error('API Key error. Please check backend configuration.', {
          duration: TOAST_DURATIONS.ERROR
        });
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      {/* Live stream modal */}
      <LiveStreamModal 
        isOpen={showLiveModal}
        onClose={() => {
          setShowLiveModal(false);
          setPendingLiveUrl(null);
          setLoading(false);
        }}
        onConfirm={handleLiveStreamChoice}
      />
      
      <div className="max-w-4xl mx-auto">
        {/* Page title */}
        <h1 className="text-3xl font-bold text-center mb-8 text-black">
          YouTube Video Validator
        </h1>
        
        {/* URL input form */}
        <form onSubmit={validateUrl} className="mb-8 bg-white p-4 rounded-lg shadow-md">
          <div className="flex gap-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter YouTube URL"
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? 'Validating...' : 'Validate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
} 