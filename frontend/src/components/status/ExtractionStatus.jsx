/**
 * Component for displaying the extraction process status
 * Used by: VideoDetails.jsx
 * Purpose: Shows the current status, progress, and available files from the extraction process
 * 
 * Flow:
 * 1. Receives status updates from VideoDetails.jsx through props
 * 2. Displays current status (completed/processing/error)
 * 3. Shows progress bar if process is ongoing
 * 4. Lists available extracted files
 * 5. Displays any error messages
 */

import PropTypes from 'prop-types';

export function ExtractionStatus({ status }) {
  // Don't render anything if no status is provided
  if (!status) return null;

  return (
    // Main container with styling
    <div className="bg-white rounded-lg shadow-lg p-6 mt-4">
      <h2 className="text-xl font-bold mb-4">Extraction Status</h2>
      
      {/* Status indicator section */}
      <div className="mb-4">
        <p className="font-medium">Status: 
          {/* Dynamic status badge with color coding */}
          <span className={`ml-2 px-2 py-1 rounded ${
            status.status === 'completed' ? 'bg-green-100 text-green-800' :
            status.status === 'processing' ? 'bg-blue-100 text-blue-800' :
            status.status === 'error' ? 'bg-red-100 text-red-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {status.status}
          </span>
        </p>

        {/* Progress bar section - only shown when progress is available */}
        {status.progress !== undefined && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className="bg-blue-600 h-2.5 rounded-full" 
                style={{ width: `${status.progress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Progress: {status.progress.toFixed(1)}%
            </p>
          </div>
        )}
      </div>

      {/* Available files list - only shown when files exist */}
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

      {/* Processing count - only shown when files are being processed */}
      {status.totalProcessing > 0 && (
        <p className="mt-2 text-sm text-gray-600">
          Files being processed: {status.totalProcessing}
        </p>
      )}

      {/* Error message - only shown when an error occurs */}
      {status.error && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 rounded">
          Error: {status.error}
        </div>
      )}
    </div>
  );
}

// PropTypes for type checking
ExtractionStatus.propTypes = {
  status: PropTypes.shape({
    status: PropTypes.string,        // Current status (completed/processing/error)
    progress: PropTypes.number,      // Progress percentage (0-100)
    availableFiles: PropTypes.arrayOf(PropTypes.string), // List of extracted files
    totalProcessing: PropTypes.number, // Number of files being processed
    error: PropTypes.string         // Error message if any
  })
}; 