import { useState } from 'react';
import axios from 'axios';
import { Toaster, toast } from 'react-hot-toast';

function App() {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  const validateUrl = async (e) => {
    e.preventDefault();
    setLoading(true);
    setVideoInfo(null);
    
    try {
      const response = await axios.post('http://localhost:3001/api/validate-youtube', { url });
      setVideoInfo(response.data);
      
      if (response.data.isExisting) {
        toast.success('Video details retrieved from existing records!', {
          duration: 4000,
          icon: '📁'
        });
      } else {
        toast.success('Video information retrieved and saved successfully!', {
          duration: 4000,
          icon: '✅'
        });
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Failed to validate URL';
      const errorDetails = error.response?.data?.details;
      
      console.error('Error:', { message: errorMessage, details: errorDetails });
      toast.error(errorMessage);
      
      if (error.response?.status === 403) {
        toast.error('API Key error. Please check backend configuration.', {
          duration: 5000
        });
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
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
