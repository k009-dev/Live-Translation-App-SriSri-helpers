/**
 * Modal Component for handling live stream processing options
 * Used by: Home.jsx
 * Purpose: Displays a modal when a live stream URL is detected, allowing users to choose
 * whether to start processing from the beginning or current point
 * 
 * Flow:
 * 1. Rendered by Home.jsx when a live stream is detected
 * 2. User selects an option (beginning/current)
 * 3. Triggers callback in Home.jsx to start processing
 */

import PropTypes from 'prop-types';

export function LiveStreamModal({ isOpen, onClose, onConfirm }) {
  // Early return if modal shouldn't be shown
  if (!isOpen) return null;

  return (
    // Modal overlay with semi-transparent background
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      {/* Modal content container */}
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
        {/* Modal header */}
        <h2 className="text-xl font-bold mb-4">Live Stream Detected</h2>
        <p className="mb-6">Please select where to start the audio extraction:</p>

        {/* Modal buttons container */}
        <div className="space-y-4">
          {/* Start from beginning button */}
          <button
            onClick={() => onConfirm('beginning')}
            className="w-full py-2 px-4 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
          >
            Start from beginning of stream
          </button>

          {/* Start from current point button */}
          <button
            onClick={() => onConfirm('current')}
            className="w-full py-2 px-4 bg-green-500 text-white rounded hover:bg-green-600 transition"
          >
            Start from current point
          </button>

          {/* Cancel button */}
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

// PropTypes for type checking
LiveStreamModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,      // Controls modal visibility
  onClose: PropTypes.func.isRequired,     // Handler for modal close
  onConfirm: PropTypes.func.isRequired    // Handler for option selection
}; 