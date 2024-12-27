/**
 * Component for displaying audio processing status for each language
 * Used by: VideoDetails.jsx
 * Purpose: Shows the status of audio processing for each target language,
 * including progress bars, audio players, and overall progress
 * 
 * Flow:
 * 1. Receives status updates from VideoDetails.jsx
 * 2. Displays a section for each language being processed
 * 3. Shows audio player and progress for each language
 * 4. Displays overall progress at the bottom
 * 
 * Dependencies:
 * - StreamingAudioPlayer for audio playback
 * - React Router for videoId extraction
 */

import PropTypes from 'prop-types';
import { useLocation } from 'react-router-dom';
import { StreamingAudioPlayer } from '../audio/StreamingAudioPlayer';

export function AudioFilesStatus({ status }) {
  console.log('📊 Rendering AudioFilesStatus:', {
    status,
    timestamp: new Date().toISOString()
  });

  // Extract videoId from URL
  const location = useLocation();
  const videoId = location.pathname.split('/').pop();
  console.log('🎥 URL analysis:', {
    fullPath: location.pathname,
    segments: location.pathname.split('/'),
    extractedVideoId: videoId
  });

  // Don't render if no status or language data
  if (!status?.audioStatus?.languageStatus) {
    console.log('⚠️ No audio status data:', {
      hasStatus: !!status,
      hasAudioStatus: !!status?.audioStatus,
      hasLanguageStatus: !!status?.audioStatus?.languageStatus,
      rawStatus: status
    });
    return null;
  }

  const languageStatuses = Object.entries(status.audioStatus.languageStatus);
  console.log('🌍 Language status analysis:', {
    totalLanguages: languageStatuses.length,
    languages: languageStatuses.map(([lang, stat]) => ({
      language: lang,
      filesCount: stat.filesCount || 0,
      progress: stat.progress || 0
    })),
    overallProgress: status.audioStatus.overallProgress
  });

  // Language display names mapping
  const languageDisplayNames = {
    Hindi: "Hindi Translation (हिंदी अनुवाद)",
    Sanskrit: "Sanskrit Translation (संस्कृत अनुवाद)",
    Marathi: "Marathi Translation (मराठी अनुवाद)"
  };

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-4">Audio Files Status</h2>

      <div className="space-y-6">
        {languageStatuses.map(([language, langStatus]) => {
          console.log(`🎵 Rendering ${language} status:`, {
            language,
            filesCount: langStatus.filesCount || 0,
            progress: langStatus.progress || 0,
            hasFiles: (langStatus.filesCount || 0) > 0,
            isComplete: (langStatus.progress || 0) === 100
          });

          return (
            <div key={language} className="bg-white rounded-lg shadow p-4">
              <h3 className="text-xl font-semibold mb-3 text-blue-600">
                {languageDisplayNames[language] || language}
              </h3>

              <div className="space-y-4">
                {console.log(`🎧 Initializing player for ${language}`)}
                <StreamingAudioPlayer videoId={videoId} language={language} />

                <div className="text-sm text-gray-600">
                  {console.log(`📊 Fragment count for ${language}:`, langStatus.filesCount || 0)}
                  Available fragments: {langStatus.filesCount || 0}
                </div>

                <div className="w-full bg-gray-200 rounded-full h-2">
                  {console.log(`📈 Progress for ${language}:`, {
                    percentage: langStatus.progress || 0,
                    isStarted: (langStatus.progress || 0) > 0,
                    isComplete: (langStatus.progress || 0) === 100
                  })}
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
          );
        })}
      </div>

      <div className="mt-4 bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-2">Overall Progress</h3>
        {console.log('📈 Overall progress analysis:', {
          percentage: status.audioStatus.overallProgress || 0,
          isStarted: (status.audioStatus.overallProgress || 0) > 0,
          isComplete: (status.audioStatus.overallProgress || 0) === 100,
          totalLanguages: languageStatuses.length,
          completedLanguages: languageStatuses.filter(
            ([_, stat]) => (stat.progress || 0) === 100
          ).length
        })}
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

// PropTypes for type checking
AudioFilesStatus.propTypes = {
  status: PropTypes.shape({
    audioStatus: PropTypes.shape({
      languageStatus: PropTypes.objectOf(PropTypes.shape({
        filesCount: PropTypes.number,
        progress: PropTypes.number
      })),
      overallProgress: PropTypes.number
    })
  })
}; 