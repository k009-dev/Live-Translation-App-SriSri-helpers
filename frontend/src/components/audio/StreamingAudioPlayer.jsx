/**
 * Component for playing streaming audio fragments
 * Used by: AudioFilesStatus.jsx
 * Purpose: Provides UI controls for audio playback of translated fragments
 * 
 * Flow:
 * 1. Uses useAudioPlayer hook for playback logic
 * 2. Renders play/pause button, volume control, and status
 * 3. Shows loading/buffering states
 * 4. Displays errors with retry option
 * 
 * Dependencies:
 * - useAudioPlayer hook for playback logic
 * - PropTypes for type checking
 */

import PropTypes from 'prop-types';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';

export function StreamingAudioPlayer({ videoId, language }) {
  console.log('🎵 Rendering StreamingAudioPlayer:', {
    videoId,
    language,
    timestamp: new Date().toISOString()
  });

  // Get audio player state and controls from hook
  const {
    isPlaying,
    isLoading,
    currentFragment,
    fragments,
    error,
    volume,
    isWaitingForNext,
    setVolume,
    setError,
    togglePlay
  } = useAudioPlayer(videoId, language);

  /**
   * Handles volume slider changes
   */
  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    console.log('🔊 Volume change requested:', {
      oldVolume: volume,
      newVolume,
      rawValue: e.target.value
    });
    setVolume(newVolume);
  };

  console.log('📊 Player state analysis:', {
    isPlaying,
    isLoading,
    currentFragment,
    fragmentCount: fragments.length,
    error,
    volume,
    isWaitingForNext,
    availableFragments: fragments,
    canPlay: !isLoading || isWaitingForNext,
    hasError: !!error
  });

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      {error ? (
        <div className="flex items-center space-x-4">
          <div className="text-red-500">
            {console.log('❌ Displaying error:', error)}
            {error}
          </div>
          <button
            onClick={() => {
              console.log('🔄 Retry clicked, clearing error:', error);
              setError(null);
            }}
            className="p-2 rounded-full bg-red-500 text-white hover:bg-red-600"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex items-center space-x-4">
          <button
            onClick={() => {
              console.log('🎵 Play/Pause clicked:', {
                currentState: isPlaying ? 'playing' : 'paused',
                isLoading,
                isWaitingForNext,
                fragmentCount: fragments.length
              });
              togglePlay();
            }}
            disabled={isLoading && !isWaitingForNext}
            className={`p-4 rounded-full ${
              (isLoading && !isWaitingForNext) || fragments.length === 0
                ? 'bg-gray-300 cursor-not-allowed'
                : isPlaying || isWaitingForNext
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-green-500 hover:bg-green-600'
            } text-white transition-colors`}
          >
            {console.log('🔄 Button state:', {
              isDisabled: isLoading && !isWaitingForNext,
              isGray: (isLoading && !isWaitingForNext) || fragments.length === 0,
              isRed: isPlaying || isWaitingForNext,
              isGreen: !isPlaying && !isWaitingForNext
            })}
            {isWaitingForNext ? '⌛ Buffering...' : 
             isPlaying ? '⏸️ Pause' : '▶️ Play'}
          </button>
          
          <div className="text-sm text-gray-600">
            {console.log('📊 Fragment counter:', {
              current: currentFragment + 1,
              total: fragments.length,
              isWaiting: isWaitingForNext
            })}
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
              onChange={handleVolumeChange}
              className="w-24"
            />
            <span className="text-sm text-gray-600">
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// PropTypes for type checking
StreamingAudioPlayer.propTypes = {
  videoId: PropTypes.string.isRequired,
  language: PropTypes.string.isRequired
}; 