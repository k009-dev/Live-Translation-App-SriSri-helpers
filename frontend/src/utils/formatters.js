/**
 * Utility functions for formatting data
 * Used by: VideoDetails.jsx
 * Purpose: Contains reusable formatting functions for displaying data in a user-friendly way
 */

/**
 * Formats YouTube duration string (PT1H2M10S) into human readable format (1h 2m 10s)
 * @param {string} duration - YouTube duration format (e.g., 'PT1H2M10S')
 * @returns {string} Formatted duration string (e.g., '1h 2m 10s')
 */
export const formatDuration = (duration) => {
  // Return 'N/A' if no duration provided
  if (!duration) return 'N/A';
  
  try {
    // Extract hours, minutes, seconds from PT format using regex
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 'N/A';

    // Destructure matched groups
    const [, hours, minutes, seconds] = match;
    const parts = [];
    
    // Build parts array with available time units
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds) parts.push(`${seconds}s`);
    
    // Join parts with spaces or return 'N/A' if no parts
    return parts.length > 0 ? parts.join(' ') : 'N/A';
  } catch (error) {
    console.error('Error formatting duration:', error);
    return 'N/A';
  }
}; 