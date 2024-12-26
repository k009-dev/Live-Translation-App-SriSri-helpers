import { useState, useEffect, useRef, useCallback } from 'react';
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

// Add this new component for streaming audio playback
function StreamingAudioPlayer({ videoId, language }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentFragment, setCurrentFragment] = useState(0);
  const [fragments, setFragments] = useState([]);
  const [error, setError] = useState(null);
  const [volume, setVolume] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isWaitingForNext, setIsWaitingForNext] = useState(false);

  const audioRef = useRef(null);
  const isUnmountingRef = useRef(false);
  const nextFragmentCheckRef = useRef(null);
  const currentDurationRef = useRef(null);

  const checkBackendAvailability = async () => {
    try {
      console.log('🔍 Checking backend availability...');
      const response = await fetch('http://localhost:3001/api/status');
      if (!response.ok) {
        throw new Error(`Backend returned status ${response.status}`);
      }
      console.log('✅ Backend is available');
      return true;
    } catch (error) {
      console.error('❌ Backend is not available:', error);
      setError('Backend server is not available. Please ensure it is running.');
      return false;
    }
  };

  const setupAudioElement = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;

      audioRef.current.addEventListener('timeupdate', () => {
        setCurrentTime(audioRef.current.currentTime);
        currentDurationRef.current = audioRef.current.duration;
        console.log(`⏱️ Playback progress: ${audioRef.current.currentTime.toFixed(2)}/${audioRef.current.duration.toFixed(2)} seconds`);
      });

      audioRef.current.addEventListener('ended', async () => {
        console.log(`✅ Fragment ${currentFragment} finished`);
        
        // Check if next fragment exists
        const nextFragment = currentFragment + 1;
        if (nextFragment < fragments.length) {
          console.log('📥 Moving to next fragment:', nextFragment);
          setCurrentFragment(nextFragment);
          setIsPlaying(true); // Keep playing state
        } else {
          console.log('⌛ Waiting for next fragment...');
          setIsWaitingForNext(true);
          setIsLoading(true);
          
          // Start checking for next fragment
          if (nextFragmentCheckRef.current) {
            clearInterval(nextFragmentCheckRef.current);
          }
          
          nextFragmentCheckRef.current = setInterval(async () => {
            const hasNewFragment = await checkForNewFragments();
            if (hasNewFragment) {
              console.log('📥 New fragment available, continuing playback');
              setIsWaitingForNext(false);
              setIsLoading(false);
              setCurrentFragment(nextFragment);
              setIsPlaying(true); // Keep playing state
              clearInterval(nextFragmentCheckRef.current);
            }
          }, 1000);
        }
      });

      audioRef.current.addEventListener('error', (e) => {
        console.error('❌ Audio error:', e);
        setError('Failed to play audio');
        setIsLoading(false);
      });
    }
  };

  const checkForNewFragments = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/audio/${videoId}/${language}/fragments`);
      const data = await response.json();
      
      if (data.files && Array.isArray(data.files)) {
        const newFragments = data.files
          .filter(f => f.endsWith('.mp3'))
          .sort((a, b) => {
            const numA = parseInt(a.match(/fragment-(\d+)\.mp3/)?.[1] || '0');
            const numB = parseInt(b.match(/fragment-(\d+)\.mp3/)?.[1] || '0');
            return numA - numB;
          });

        if (newFragments.length > fragments.length) {
          console.log(`📥 Found ${newFragments.length - fragments.length} new fragments`);
          setFragments(newFragments);
          
          // If we're waiting for next fragment and find one, auto-play it
          if (isWaitingForNext && currentFragment + 1 < newFragments.length) {
            console.log('📥 New fragment available, auto-playing');
            setCurrentFragment(currentFragment + 1);
            setIsWaitingForNext(false);
            setIsLoading(false);
            setIsPlaying(true);
            return true;
          }
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Error checking fragments:', error);
      return false;
    }
  };

  const loadAudio = async () => {
    if (!fragments[currentFragment]) return;
    
    const fragmentName = fragments[currentFragment];
    const url = `http://localhost:3001/api/audio/${videoId}/${language}/${fragmentName}`;
    console.log(`🔗 Loading audio from URL: ${url}`);
    
    // Only reset time values if we're loading a new URL
    if (audioRef.current?.src !== url) {
      console.log('Loading new audio file, resetting time values');
      setCurrentTime(0);
      currentDurationRef.current = null;
      audioRef.current.src = url;
      await audioRef.current.load();
    } else {
      console.log('Audio file already loaded, preserving time values');
    }
  };

  const togglePlay = async () => {
    try {
      console.log('🎵 Toggle play clicked');
      console.log('Current state:', { 
        isPlaying, 
        currentFragment, 
        fragmentsCount: fragments.length,
        isWaitingForNext,
        currentTime: audioRef.current?.currentTime,
        duration: currentDurationRef.current
      });

      if (!await checkBackendAvailability()) {
        throw new Error('Backend is not available');
      }

      if (isPlaying || isWaitingForNext) {
        console.log('⏸️ Pausing playback');
        await audioRef.current?.pause();
        setIsPlaying(false);
        setIsWaitingForNext(false);
        setIsLoading(false);
        if (nextFragmentCheckRef.current) {
          clearInterval(nextFragmentCheckRef.current);
        }
      } else {
        console.log('▶️ Starting playback');
        setupAudioElement();
        
        // Only check for end of fragment if we have a valid duration and current time
        const hasValidTime = audioRef.current?.currentTime !== undefined && 
                           currentDurationRef.current && 
                           !audioRef.current.error;
                           
        const wasAtEnd = hasValidTime && (currentTime >= (currentDurationRef.current - 0.1));
        
        console.log('Time check:', {
          hasValidTime,
          wasAtEnd,
          currentTime,
          duration: currentDurationRef.current,
          error: audioRef.current?.error
        });

        // Check if we have new fragments available
        const hasNewFragments = currentFragment + 1 < fragments.length;

        if (wasAtEnd && !hasNewFragments) {
          console.log('⌛ Was at end of fragment and no new fragments, resuming buffering');
          setIsWaitingForNext(true);
          setIsLoading(true);
          
          // Start checking for next fragment
          if (nextFragmentCheckRef.current) {
            clearInterval(nextFragmentCheckRef.current);
          }
          
          nextFragmentCheckRef.current = setInterval(async () => {
            const hasNewFragment = await checkForNewFragments();
            if (hasNewFragment) {
              console.log('📥 New fragment available, continuing playback');
              setIsWaitingForNext(false);
              setIsLoading(false);
              setCurrentFragment(currentFragment + 1);
              setIsPlaying(true);
              clearInterval(nextFragmentCheckRef.current);
            }
          }, 1000);
          return;
        } else if (wasAtEnd && hasNewFragments) {
          console.log('📥 Moving to next available fragment');
          setCurrentFragment(currentFragment + 1);
          setIsWaitingForNext(false);
          setIsLoading(false);
          setIsPlaying(true);
          return;
        }

        // Only load audio if we don't have a source or there was an error
        if (!audioRef.current.src || audioRef.current.error) {
          await loadAudio();
        }
        
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('❌ Error toggling playback:', error);
      setError('Failed to toggle playback: ' + error.message);
      setIsPlaying(false);
      setIsLoading(false);
    }
  };

  // Effect for loading fragments
  useEffect(() => {
    const checkFragments = async () => {
      if (isUnmountingRef.current) return;
      await checkForNewFragments();
    };

    checkFragments();
    const interval = setInterval(checkFragments, 2000);

    return () => {
      console.log('🧹 Cleaning up audio player...');
      isUnmountingRef.current = true;
      clearInterval(interval);
      if (nextFragmentCheckRef.current) {
        clearInterval(nextFragmentCheckRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, [videoId, language]);

  // Effect for handling fragment changes
  useEffect(() => {
    const loadAndPlay = async () => {
      try {
        if (isPlaying || (!isPlaying && !isWaitingForNext)) {
          // Only load if this is a new fragment
          const currentUrl = audioRef.current?.src;
          const newUrl = `http://localhost:3001/api/audio/${videoId}/${language}/${fragments[currentFragment]}`;
          
          if (currentUrl !== newUrl) {
            await loadAudio();
            if (isPlaying) {
              console.log('▶️ Auto-playing next fragment');
              await audioRef.current?.play().catch(error => {
                console.error('Failed to auto-play:', error);
                setIsPlaying(false);
              });
            }
          }
        }
      } catch (error) {
        console.error('Failed to load/play audio:', error);
        setError('Failed to play audio');
        setIsPlaying(false);
      }
    };

    loadAndPlay();
  }, [currentFragment]);

  // Effect for handling play state changes
  useEffect(() => {
    const handlePlayStateChange = async () => {
      try {
        if (isPlaying && audioRef.current && !audioRef.current.error) {
          console.log('▶️ Play state changed to true, starting playback');
          if (audioRef.current.paused) {
            await audioRef.current.play().catch(error => {
              console.error('Failed to play on state change:', error);
              setIsPlaying(false);
            });
          }
        }
      } catch (error) {
        console.error('Failed to handle play state change:', error);
        setError('Failed to play audio');
        setIsPlaying(false);
      }
    };

    handlePlayStateChange();
  }, [isPlaying]);

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      {error ? (
        <div className="flex items-center space-x-4">
          <div className="text-red-500">{error}</div>
          <button
            onClick={() => setError(null)}
            className="p-2 rounded-full bg-red-500 text-white hover:bg-red-600"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center space-x-4">
            <button
              onClick={togglePlay}
              disabled={isLoading && !isWaitingForNext}
              className={`p-4 rounded-full ${
                (isLoading && !isWaitingForNext) || fragments.length === 0
                  ? 'bg-gray-300 cursor-not-allowed'
                  : isPlaying || isWaitingForNext
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-green-500 hover:bg-green-600'
              } text-white transition-colors`}
            >
              {isWaitingForNext ? (
                '⌛ Buffering...'
              ) : isPlaying ? (
                '⏸️ Pause'
              ) : (
                '▶️ Play'
              )}
            </button>
            
            <div className="text-sm text-gray-600">
              Fragment: {currentFragment + 1}/{fragments.length || 0}
              {isWaitingForNext && ' (Waiting for next fragment...)'}
            </div>

            <div className="flex items-center space-x-2">
              <label htmlFor="volume" className="text-sm text-gray-600">
                Volume:
              </label>
              <input
                id="volume"
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-gray-600">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Update AudioFilesStatus component
function AudioFilesStatus({ status }) {
  const videoId = window.location.pathname.split('/').pop();
  if (!status?.audioStatus?.languageStatus) return null;

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-4">Audio Files Status</h2>
      <div className="space-y-6">
        {Object.entries(status.audioStatus.languageStatus).map(([language, langStatus]) => (
          <div key={language} className="bg-white rounded-lg shadow p-4">
            <h3 className="text-xl font-semibold mb-3">{language}</h3>
            <div className="space-y-4">
              <StreamingAudioPlayer videoId={videoId} language={language} />
              <div className="text-sm text-gray-600">
                Available fragments: {langStatus.filesCount || 0}
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${langStatus.progress || 0}%` }}
                ></div>
              </div>
              <div className="text-sm text-gray-600">
                Progress: {(langStatus.progress || 0).toFixed(1)}%
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-2">Overall Progress</h3>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-green-600 h-2 rounded-full transition-all duration-300" 
            style={{ width: `${status.audioStatus.overallProgress || 0}%` }}
          ></div>
        </div>
        <div className="text-sm text-gray-600 mt-1">
          {(status.audioStatus.overallProgress || 0).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

// VideoDetails component
function VideoDetails() {
  const [videoInfo, setVideoInfo] = useState(null);
  const [extractionStatus, setExtractionStatus] = useState(null);
  const videoId = window.location.pathname.split('/').pop();

  useEffect(() => {
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
        Promise.all([
          axios.get(`http://localhost:3001/api/extraction-status/${videoId}`),
          axios.get(`http://localhost:3001/api/audio-status/${videoId}`)
        ])
          .then(([extractionRes, audioRes]) => {
            console.log('Extraction status:', extractionRes.data);
            console.log('Audio status:', audioRes.data);
            setExtractionStatus({
              ...extractionRes.data,
              audioStatus: audioRes.data,
              videoId
            });
          })
          .catch(error => {
            console.error('Error fetching status:', error);
          });
      }, 2000);

      return () => {
        clearInterval(pollInterval);
      };
    }
  }, [videoId]);

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {videoInfo ? (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
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
            </div>
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
