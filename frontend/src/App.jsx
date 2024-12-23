import { useState, useEffect } from 'react';
import axios from 'axios';
import { Toaster, toast } from 'react-hot-toast';

// LiveStreamModal Component
function LiveStreamModal({ isOpen, onClose, onConfirm }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">Live Stream Detected</h2>
        <p className="mb-6">Please select where to start the audio extraction:</p>
        <div className="space-y-4">
          <button
            onClick={() => onConfirm('beginning')}
            className="w-full py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
          >
            Start from beginning of stream
          </button>
          <button
            onClick={() => onConfirm('current')}
            className="w-full py-2 px-4 bg-green-500 text-white rounded hover:bg-green-600 transition"
          >
            Start from current point
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [pendingLiveUrl, setPendingLiveUrl] = useState(null);
  const [extractionStatus, setExtractionStatus] = useState(null);

  // Add polling function for extraction status
  useEffect(() => {
    let pollInterval;

    if (videoInfo?.savedLocation) {
      // Start polling immediately
      checkExtractionStatus(videoInfo.savedLocation);
      
      // Set up polling interval (every 2 seconds)
      pollInterval = setInterval(() => {
        checkExtractionStatus(videoInfo.savedLocation);
      }, 2000);
    }

    // Cleanup polling on unmount or when video changes
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [videoInfo?.savedLocation]);

  // Function to check extraction status
  const checkExtractionStatus = async (savedLocation) => {
    try {
      const response = await axios.get(`http://localhost:3001/api/extraction-status/${savedLocation}`);
      console.log('Extraction status response:', response.data); // Debug logging
      setExtractionStatus(response.data);
    } catch (error) {
      console.error('Error checking extraction status:', error);
    }
  };

  const handleLiveStreamChoice = async (choice) => {
    setShowLiveModal(false);
    if (!pendingLiveUrl) return;

    setLoading(true);
    try {
      const response = await axios.post('http://localhost:3001/api/validate-youtube', { 
        url: pendingLiveUrl,
        liveStreamChoice: choice 
      });
      setVideoInfo(response.data);
      
      toast.success('Live stream processing started!', {
        duration: 4000,
        icon: '🎥'
      });
    } catch (error) {
      console.error('Error:', error);
      toast.error(error.response?.data?.error || 'Failed to process live stream');
    } finally {
      setLoading(false);
      setPendingLiveUrl(null);
    }
  };

  const validateUrl = async (e) => {
    e.preventDefault();
    setLoading(true);
    setVideoInfo(null);
    setExtractionStatus(null);
    
    try {
      // First, check if it's a live stream
      const checkResponse = await axios.post('http://localhost:3001/api/validate-youtube', { 
        url,
        checkOnly: true 
      });

      if (checkResponse.data.isLiveContent) {
        setPendingLiveUrl(url);
        setShowLiveModal(true);
        setLoading(false);
        return;
      }

      // If not live, proceed normally
      const response = await axios.post('http://localhost:3001/api/validate-youtube', { url });
      setVideoInfo(response.data);
      
      if (response.data.isExisting) {
        if (response.data.audioStatus?.exists) {
          toast.success('Video and audio already exist!', {
            duration: 4000,
            icon: '📁'
          });
        } else if (response.data.audioExtraction) {
          toast.success('Video exists, started audio extraction!', {
            duration: 4000,
            icon: '🎵'
          });
        } else {
          toast.error('Video exists but audio extraction failed', {
            duration: 4000,
            icon: '⚠️'
          });
        }
      } else {
        toast.success('Video validated and audio extraction started!', {
          duration: 4000,
          icon: '✅'
        });
      }
    } catch (error) {
      console.error('Error:', error);
      
      if (error.code === 'ERR_NETWORK') {
        toast.error('Cannot connect to server. Please make sure the backend is running.', {
          duration: 5000
        });
      } else {
        const errorMessage = error.response?.data?.error || 'Failed to validate URL';
        const errorDetails = error.response?.data?.details;
        
        console.error('Error details:', { message: errorMessage, details: errorDetails });
        toast.error(errorMessage);
        
        if (error.response?.status === 403) {
          toast.error('API Key error. Please check backend configuration.', {
            duration: 5000
          });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (duration) => {
    if (!duration) return 'N/A';
    
    try {
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 'N/A';

      const [, hours, minutes, seconds] = match;
      const parts = [];
      
      if (hours) parts.push(`${hours}h`);
      if (minutes) parts.push(`${minutes}m`);
      if (seconds) parts.push(`${seconds}s`);
      
      return parts.length > 0 ? parts.join(' ') : 'N/A';
    } catch (error) {
      console.error('Error formatting duration:', error);
      return 'N/A';
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <Toaster position="top-right" />
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
        <h1 className="text-3xl font-bold text-center mb-8 text-black">YouTube Video Validator</h1>
        
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

        {videoInfo && (
          <div className="bg-white rounded-lg shadow-lg p-6 text-black">
            {videoInfo.isExisting && (
              <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded-lg">
                <p className="font-medium">
                  ℹ️ This video was previously validated and saved as "{videoInfo.savedLocation}"
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <img
                  src={videoInfo.thumbnails.maxres?.url || videoInfo.thumbnails.high?.url}
                  alt={videoInfo.title}
                  className="w-full rounded-lg"
                />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-4">{videoInfo.title}</h2>
                <div className="space-y-2">
                  <p><span className="font-medium">Channel:</span> {videoInfo.channelTitle}</p>
                  <p><span className="font-medium">Duration:</span> {formatDuration(videoInfo.duration)}</p>
                  <p><span className="font-medium">Privacy:</span> {videoInfo.privacyStatus}</p>
                  <p><span className="font-medium">Type:</span> {videoInfo.isLiveContent ? 'Live Content' : 'Regular Video'}</p>
                  <p><span className="font-medium">Saved Location:</span> {videoInfo.savedLocation}</p>
                </div>
                <div className="mt-4">
                  <h3 className="font-medium mb-2">Description:</h3>
                  <p className="text-sm text-gray-600 max-h-32 overflow-y-auto">
                    {videoInfo.description || 'No description available'}
                  </p>
                </div>
                {videoInfo.liveStreamingDetails && (
                  <div className="mt-4">
                    <h3 className="font-medium mb-2">Live Stream Details:</h3>
                    <div className="text-sm text-gray-600">
                      {videoInfo.liveStreamingDetails.scheduledStartTime && (
                        <p>Scheduled Start: {new Date(videoInfo.liveStreamingDetails.scheduledStartTime).toLocaleString()}</p>
                      )}
                      {videoInfo.liveStreamingDetails.actualStartTime && (
                        <p>Actual Start: {new Date(videoInfo.liveStreamingDetails.actualStartTime).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Add extraction status display */}
            {extractionStatus && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium mb-2">Extraction Status:</h3>
                <div className="space-y-2">
                  {extractionStatus.type === 'live' && (
                    <>
                      <p className="text-sm">
                        <span className="font-medium">Status:</span> Active
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Available Fragments:</span> {extractionStatus.chunkCount || 0}
                        {extractionStatus.totalProcessing > extractionStatus.chunkCount && (
                          <span className="text-gray-500 ml-2">
                            ({extractionStatus.totalProcessing - extractionStatus.chunkCount} processing)
                          </span>
                        )}
                      </p>
                      {extractionStatus.availableFiles && extractionStatus.availableFiles.length > 0 && (
                        <div className="text-sm">
                          <p className="font-medium mb-1">Available Files:</p>
                          <div className="max-h-32 overflow-y-auto bg-white p-2 rounded border">
                            {extractionStatus.availableFiles.map((file, index) => (
                              <p key={index} className="text-xs text-gray-600">
                                {file} {file === extractionStatus.latestChunk && 
                                  <span className="text-blue-500 text-xs">(Latest)</span>}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {extractionStatus.type === 'normal' && (
                    <>
                      <p className="text-sm">
                        <span className="font-medium">Status:</span>{' '}
                        {extractionStatus.status === 'completed' ? 'Completed' :
                         extractionStatus.status === 'error' ? 'Error' :
                         extractionStatus.status === 'downloading' ? 'Downloading' : 'Processing'}
                      </p>
                      {extractionStatus.progress !== undefined && (
                        <div className="space-y-1">
                          <p className="text-sm">
                            <span className="font-medium">Progress:</span> {Math.round(extractionStatus.progress)}%
                          </p>
                          <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div 
                              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                              style={{ width: `${extractionStatus.progress}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      {extractionStatus.error && (
                        <p className="text-sm text-red-600">
                          Error: {extractionStatus.error}
                        </p>
                      )}
                      {extractionStatus.availableFiles?.length > 0 && (
                        <div className="text-sm">
                          <p className="font-medium mb-1">Available Files:</p>
                          <div className="max-h-32 overflow-y-auto bg-white p-2 rounded border">
                            {extractionStatus.availableFiles.map((file, index) => (
                              <p key={index} className="text-xs text-gray-600">
                                {file}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
