import { useState, useEffect } from 'react';
import axios from 'axios';
import { Toaster, toast } from 'react-hot-toast';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';

// Utility function to format duration
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

// Add this component after LiveStreamModal
function ExtractionStatus({ status }) {
  if (!status) return null;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mt-4">
      <h2 className="text-xl font-bold mb-4">Extraction Status</h2>
      
      <div className="mb-4">
        <p className="font-medium">Status: 
          <span className={`ml-2 px-2 py-1 rounded ${
            status.status === 'completed' ? 'bg-green-100 text-green-800' :
            status.status === 'processing' ? 'bg-blue-100 text-blue-800' :
            status.status === 'error' ? 'bg-red-100 text-red-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {status.status}
          </span>
        </p>
        {status.progress !== undefined && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className="bg-blue-600 h-2.5 rounded-full" 
                style={{ width: `${status.progress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600 mt-1">Progress: {status.progress.toFixed(1)}%</p>
          </div>
        )}
      </div>

      {status.availableFiles && status.availableFiles.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Extracted Files:</h3>
          <div className="bg-gray-50 p-4 rounded-lg max-h-60 overflow-y-auto">
            {status.availableFiles.map((file, index) => (
              <div 
                key={file}
                className={`py-2 px-3 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} rounded`}
              >
                {file}
              </div>
            ))}
          </div>
        </div>
      )}

      {status.totalProcessing > 0 && (
        <p className="mt-2 text-sm text-gray-600">
          Files being processed: {status.totalProcessing}
        </p>
      )}

      {status.error && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 rounded">
          Error: {status.error}
        </div>
      )}
    </div>
  );
}

// VideoDetails component
function VideoDetails() {
  const [videoInfo, setVideoInfo] = useState(null);
  const [extractionStatus, setExtractionStatus] = useState(null);

  useEffect(() => {
    // Get video ID from URL
    const videoId = window.location.pathname.split('/').pop();
    if (videoId) {
      // Fetch video details
      axios.post('http://localhost:3001/api/validate-youtube', { 
        url: `https://www.youtube.com/watch?v=${videoId}`,
        checkOnly: true 
      })
      .then(response => {
        setVideoInfo(response.data);
      })
      .catch(error => {
        console.error('Error fetching video details:', error);
        toast.error('Failed to load video details');
      });

      // Set up polling for extraction status
      const pollInterval = setInterval(() => {
        axios.get(`http://localhost:3001/api/extraction-status/${videoId}`)
          .then(response => {
            console.log('Extraction status:', response.data);
            setExtractionStatus(response.data);
          })
          .catch(error => {
            console.error('Error fetching extraction status:', error);
          });
      }, 2000); // Poll every 2 seconds

      // Cleanup interval on unmount
      return () => clearInterval(pollInterval);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {videoInfo ? (
          <div className="bg-white rounded-lg shadow-lg p-6 text-black">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <img
                  src={videoInfo.thumbnails?.maxres?.url || videoInfo.thumbnails?.high?.url}
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
                </div>
                <div className="mt-4">
                  <h3 className="font-medium mb-2">Description:</h3>
                  <p className="text-sm text-gray-600 max-h-32 overflow-y-auto">
                    {videoInfo.description || 'No description available'}
                  </p>
                </div>
              </div>
            </div>
            <ExtractionStatus status={extractionStatus} />
          </div>
        ) : (
          <div className="text-center">Loading video details...</div>
        )}
      </div>
    </div>
  );
}

// Main App component
function MainApp() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [pendingLiveUrl, setPendingLiveUrl] = useState(null);
  const navigate = useNavigate();

  const handleLiveStreamChoice = async (choice) => {
    setShowLiveModal(false);
    if (!pendingLiveUrl) return;

    setLoading(true);
    try {
      const response = await axios.post('http://localhost:3001/api/validate-youtube', { 
        url: pendingLiveUrl,
        liveStreamChoice: choice 
      });
      
      toast.success('Live stream processing started!', {
        duration: 4000,
        icon: '🎥'
      });

      // Navigate to details page
      navigate(`/details/${response.data.id}`);
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
    
    try {
      // First, check if it's a live stream
      const checkResponse = await axios.post('http://localhost:3001/api/validate-youtube', { 
        url,
        checkOnly: true 
      });

      console.log('Initial check response:', checkResponse.data);

      if (checkResponse.data.isLiveContent) {
        setPendingLiveUrl(url);
        setShowLiveModal(true);
        setLoading(false);
        return;
      }

      // Extract videoId first from URL, then fallback to response
      const urlVideoId = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/user\/\S+|\/ytscreeningroom\?v=|\/sandalsResorts#\w\/\w\/.*\/))([^\/&\n?\s]{11})/)?.[1];
      const videoId = urlVideoId || checkResponse.data.id;
      console.log('Extracted videoId:', videoId, 'from URL:', urlVideoId, 'from response:', checkResponse.data.id);
      
      if (videoId) {
        // Start the extraction process in the background
        axios.post('http://localhost:3001/api/validate-youtube', { url })
          .then(() => {
            console.log('Extraction process started in background');
          })
          .catch(error => {
            console.error('Background extraction error:', error);
          });

        // Immediately navigate to details page
        console.log('Navigating to:', `/details/${videoId}`);
        navigate(`/details/${videoId}`);
        
        // Show success toast
        toast.success('Video validated and processing started!', {
          duration: 4000,
          icon: '✅'
        });
      } else {
        console.error('No videoId found in URL or response');
        toast.error('Could not process video. Invalid video ID.');
      }

    } catch (error) {
      console.error('Validation error:', error);
      
      if (error.code === 'ERR_NETWORK') {
        toast.error('Cannot connect to server. Please make sure the backend is running.', {
          duration: 5000
        });
      } else {
        const errorMessage = error.response?.data?.error || 'Failed to validate URL';
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
      </div>
    </div>
  );
}

// Wrap the app with Router
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/details/:videoId" element={<VideoDetails />} />
      </Routes>
    </Router>
  );
}

export default App;
