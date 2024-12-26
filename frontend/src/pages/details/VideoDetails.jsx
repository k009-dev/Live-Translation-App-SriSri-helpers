/**
 * Page component for displaying video details and processing status
 * Purpose: Shows video information, extraction progress, and audio processing status
 * 
 * Flow:
 * 1. Extracts videoId from URL parameters
 * 2. Fetches video details from YouTube
 * 3. Polls for extraction and audio processing status
 * 4. Displays video info, extraction status, and audio status
 * 
 * Dependencies:
 * - ExtractionStatus for showing extraction progress
 * - AudioFilesStatus for showing audio processing
 * - formatDuration for time formatting
 * - Backend API for data fetching
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { formatDuration } from '../../utils/formatters';
import { ExtractionStatus } from '../../components/status/ExtractionStatus';
import { AudioFilesStatus } from '../../components/status/AudioFilesStatus';
import { API_ENDPOINTS, POLLING_INTERVALS, TOAST_DURATIONS } from '../../utils/constants';

export function VideoDetails() {
  // State management
  const [videoInfo, setVideoInfo] = useState(null);
  const [extractionStatus, setExtractionStatus] = useState(null);
  const { videoId } = useParams();

  useEffect(() => {
    if (videoId) {
      // Fetch initial video details
      fetchVideoDetails();
      // Start polling for status updates
      const pollInterval = startStatusPolling();

      // Cleanup polling on unmount
      return () => clearInterval(pollInterval);
    }
  }, [videoId]);

  /**
   * Fetches video details from YouTube
   */
  const fetchVideoDetails = async () => {
    try {
      const response = await axios.post(API_ENDPOINTS.VALIDATE_YOUTUBE, { 
        url: `https://www.youtube.com/watch?v=${videoId}`,
        checkOnly: true 
      });
      setVideoInfo(response.data);
    } catch (error) {
      console.error('Error fetching video details:', error);
      toast.error('Failed to load video details', {
        duration: TOAST_DURATIONS.ERROR
      });
    }
  };

  /**
   * Starts polling for extraction and audio status
   * @returns {number} Interval ID for cleanup
   */
  const startStatusPolling = () => {
    return setInterval(() => {
      Promise.all([
        axios.get(API_ENDPOINTS.EXTRACTION_STATUS(videoId)),
        axios.get(API_ENDPOINTS.AUDIO_STATUS(videoId))
      ])
        .then(([extractionRes, audioRes]) => {
          setExtractionStatus({
            ...extractionRes.data,
            audioStatus: audioRes.data,
            videoId
          });
        })
        .catch(error => {
          console.error('Error fetching status:', error);
        });
    }, POLLING_INTERVALS.EXTRACTION_STATUS);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {videoInfo ? (
          <div className="space-y-6">
            {/* Video information card */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Video thumbnail */}
                <div>
                  <img
                    src={videoInfo.thumbnails?.maxres?.url || videoInfo.thumbnails?.high?.url}
                    alt={videoInfo.title}
                    className="w-full rounded-lg"
                  />
                </div>

                {/* Video details */}
                <div>
                  <h2 className="text-xl font-semibold mb-4">{videoInfo.title}</h2>
                  <div className="space-y-2">
                    <p><span className="font-medium">Channel:</span> {videoInfo.channelTitle}</p>
                    <p><span className="font-medium">Duration:</span> {formatDuration(videoInfo.duration)}</p>
                    <p><span className="font-medium">Privacy:</span> {videoInfo.privacyStatus}</p>
                    <p><span className="font-medium">Type:</span> {videoInfo.isLiveContent ? 'Live Content' : 'Regular Video'}</p>
                  </div>

                  {/* Video description */}
                  <div className="mt-4">
                    <h3 className="font-medium mb-2">Description:</h3>
                    <p className="text-sm text-gray-600 max-h-32 overflow-y-auto">
                      {videoInfo.description || 'No description available'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Status components */}
            <ExtractionStatus status={extractionStatus} />
            <AudioFilesStatus status={extractionStatus} />
          </div>
        ) : (
          <div className="text-center">Loading video details...</div>
        )}
      </div>
    </div>
  );
} 