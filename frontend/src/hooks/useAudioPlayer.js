/**
 * Custom hook for managing audio playback of streaming fragments
 * Used by: StreamingAudioPlayer.jsx
 * Purpose: Handles all audio playback logic, fragment management, and backend communication
 * 
 * Flow:
 * 1. Initializes audio player and state
 * 2. Polls backend for new fragments
 * 3. Manages playback state and fragment transitions
 * 4. Handles errors and cleanup
 * 
 * Dependencies:
 * - Backend API endpoints for fragment fetching
 * - Browser's Audio API
 */

import { useState, useEffect, useRef } from 'react';
import { API_ENDPOINTS, API_BASE_URL, POLLING_INTERVALS } from '../utils/constants';

export function useAudioPlayer(videoId, language) {
  console.log('🎵 Initializing useAudioPlayer:', { videoId, language });
  console.log('📍 API Base URL:', API_BASE_URL);
  console.log('🔗 Audio fragments endpoint:', API_ENDPOINTS.AUDIO_FRAGMENTS(videoId, language));

  // Player state initialization
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentFragment, setCurrentFragment] = useState(0);
  const [fragments, setFragments] = useState([]);
  const [error, setError] = useState(null);
  const [volume, setVolume] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isWaitingForNext, setIsWaitingForNext] = useState(false);

  // Refs initialization
  const audioRef = useRef(null);
  const isUnmountingRef = useRef(false);
  const nextFragmentCheckRef = useRef(null);
  const currentDurationRef = useRef(null);

  const checkBackendAvailability = async () => {
    console.log('🔍 Checking backend availability...');
    console.log('🔗 Status endpoint:', API_ENDPOINTS.SERVER_STATUS);
    
    try {
      const response = await fetch(API_ENDPOINTS.SERVER_STATUS);
      console.log('📡 Backend response status:', response.status);
      
      if (!response.ok) {
        console.error('❌ Backend error:', {
          status: response.status,
          statusText: response.statusText
        });
        throw new Error(`Backend returned status ${response.status} (${response.statusText})`);
      }
      
      const data = await response.json();
      console.log('✅ Backend status data:', data);
      return true;
    } catch (error) {
      console.error('❌ Backend availability error:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      setError('Backend server is not available. Please ensure it is running.');
      return false;
    }
  };

  const setupAudioElement = () => {
    console.log('🎧 Setting up audio element');
    console.log('Current audio ref state:', {
      exists: !!audioRef.current,
      src: audioRef.current?.src,
      error: audioRef.current?.error
    });

    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
      console.log('🔊 Initial volume set to:', volume);

      // Debug loading states
      audioRef.current.addEventListener('loadstart', () => {
        console.log('🔄 Audio loading started:', {
          src: audioRef.current.src,
          readyState: audioRef.current.readyState,
          networkState: audioRef.current.networkState
        });
      });

      audioRef.current.addEventListener('waiting', () => {
        console.log('⌛ Audio waiting for data:', {
          currentTime: audioRef.current.currentTime,
          buffered: audioRef.current.buffered.length ? 
            [...Array(audioRef.current.buffered.length)].map((_, i) => ({
              start: audioRef.current.buffered.start(i),
              end: audioRef.current.buffered.end(i)
            })) : []
        });
      });

      audioRef.current.addEventListener('stalled', () => {
        console.warn('⚠️ Audio download stalled:', {
          src: audioRef.current.src,
          networkState: audioRef.current.networkState
        });
      });

      audioRef.current.addEventListener('suspend', () => {
        console.log('🔍 Audio loading suspended:', {
          readyState: audioRef.current.readyState,
          networkState: audioRef.current.networkState
        });
      });

      audioRef.current.addEventListener('canplay', () => {
        console.log('✅ Audio can start playing:', {
          duration: audioRef.current.duration,
          readyState: audioRef.current.readyState
        });
      });

      audioRef.current.addEventListener('timeupdate', () => {
        const currentTime = audioRef.current.currentTime;
        const duration = audioRef.current.duration;
        setCurrentTime(currentTime);
        currentDurationRef.current = duration;
        
        console.log(`⏱️ Playback progress:`, {
          currentTime: currentTime.toFixed(2),
          duration: duration.toFixed(2),
          percentage: ((currentTime / duration) * 100).toFixed(1) + '%',
          readyState: audioRef.current.readyState
        });
      });

      audioRef.current.addEventListener('ended', async () => {
        console.log(`✅ Fragment ${currentFragment} finished:`, {
          duration: audioRef.current.duration,
          currentTime: audioRef.current.currentTime
        });
        
        const nextFragment = currentFragment + 1;
        console.log('📊 Next fragment check:', {
          current: currentFragment,
          next: nextFragment,
          totalFragments: fragments.length,
          hasMore: nextFragment < fragments.length
        });
        
        if (nextFragment < fragments.length) {
          console.log('📥 Moving to next fragment:', nextFragment);
          setCurrentFragment(nextFragment);
          setIsPlaying(true);
        } else {
          console.log('⌛ Waiting for next fragment...', {
            currentFragment,
            fragmentsAvailable: fragments.length
          });
          setIsWaitingForNext(true);
          setIsLoading(true);
          startFragmentPolling();
        }
      });

      audioRef.current.addEventListener('error', (e) => {
        const error = audioRef.current.error;
        console.error('❌ Audio error:', {
          code: error.code,
          message: error.message,
          currentSrc: audioRef.current.src,
          readyState: audioRef.current.readyState,
          networkState: audioRef.current.networkState,
          event: e
        });
        
        // Map error codes to meaningful messages
        const errorMessages = {
          1: 'Audio loading aborted',
          2: 'Network error while loading audio',
          3: 'Audio decoding failed',
          4: 'Audio format not supported'
        };
        
        setError(`Failed to play audio: ${errorMessages[error.code] || error.message}`);
        setIsLoading(false);
      });

      console.log('✅ Audio element setup complete with all event listeners');
    }
  };

  const startFragmentPolling = () => {
    console.log('🔄 Starting fragment polling:', {
      interval: POLLING_INTERVALS.FRAGMENT_CHECK,
      existingInterval: !!nextFragmentCheckRef.current
    });

    if (nextFragmentCheckRef.current) {
      console.log('🧹 Clearing existing poll interval:', nextFragmentCheckRef.current);
      clearInterval(nextFragmentCheckRef.current);
    }
    
    nextFragmentCheckRef.current = setInterval(async () => {
      console.log('🔍 Polling for new fragments:', {
        currentFragment,
        totalFragments: fragments.length
      });
      
      const hasNewFragment = await checkForNewFragments();
      console.log('📊 Poll result:', {
        hasNewFragment,
        currentFragment,
        fragmentsCount: fragments.length
      });

      if (hasNewFragment) {
        console.log('✨ New fragment found, updating state');
        setIsWaitingForNext(false);
        setIsLoading(false);
        setCurrentFragment(currentFragment + 1);
        setIsPlaying(true);
        clearInterval(nextFragmentCheckRef.current);
      }
    }, POLLING_INTERVALS.FRAGMENT_CHECK);
  };

  const checkForNewFragments = async () => {
    try {
      console.log('🔍 Fetching fragments list:', {
        url: API_ENDPOINTS.AUDIO_FRAGMENTS(videoId, language),
        currentCount: fragments.length
      });

      const response = await fetch(API_ENDPOINTS.AUDIO_FRAGMENTS(videoId, language));
      if (!response.ok) {
        console.error('❌ Fragments fetch error:', {
          status: response.status,
          statusText: response.statusText
        });
        throw new Error(`Failed to fetch fragments: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📦 Fragments response:', data);
      
      if (data.files && Array.isArray(data.files)) {
        console.log('📁 Processing files:', data.files);
        const newFragments = data.files
          .filter(f => {
            const isMP3 = f.endsWith('.mp3');
            if (!isMP3) console.warn('⚠️ Skipping non-MP3 file:', f);
            return isMP3;
          })
          .sort((a, b) => {
            const numA = parseInt(a.match(/fragment-(\d+)\.mp3/)?.[1] || '0');
            const numB = parseInt(b.match(/fragment-(\d+)\.mp3/)?.[1] || '0');
            return numA - numB;
          });

        console.log('📊 Fragments analysis:', {
          current: fragments.length,
          new: newFragments.length,
          difference: newFragments.length - fragments.length,
          newFiles: newFragments.slice(fragments.length)
        });

        if (newFragments.length > fragments.length) {
          console.log(`📥 Found ${newFragments.length - fragments.length} new fragments:`, 
            newFragments.slice(fragments.length));
          setFragments(newFragments);
          
          if (isWaitingForNext && currentFragment + 1 < newFragments.length) {
            console.log('🎵 Conditions met for auto-play:', {
              isWaiting: isWaitingForNext,
              currentFragment,
              newFragmentsAvailable: newFragments.length
            });
            return true;
          }
          return true;
        }
      } else {
        console.warn('⚠️ Unexpected fragments response format:', data);
      }
      return false;
    } catch (error) {
      console.error('❌ Fragment check error:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      return false;
    }
  };

  const loadAudio = async () => {
    console.log('📥 Load audio called:', {
      currentFragment,
      fragmentsAvailable: fragments.length,
      currentFragmentFile: fragments[currentFragment]
    });

    if (!fragments[currentFragment]) {
      console.warn('⚠️ No fragment available to load:', {
        currentFragment,
        fragments,
        fragmentsLength: fragments.length
      });
      return;
    }
    
    const fragmentName = fragments[currentFragment];
    const url = `${API_BASE_URL}/api/audio/${videoId}/${language}/${fragmentName}`;
    console.log('🔗 Audio URL construction:', {
      base: API_BASE_URL,
      videoId,
      language,
      fragment: fragmentName,
      fullUrl: url
    });
    
    if (audioRef.current?.src !== url) {
      console.log('📥 Loading new audio file:', {
        currentSrc: audioRef.current?.src,
        newSrc: url,
        readyState: audioRef.current?.readyState
      });

      try {
        setCurrentTime(0);
        currentDurationRef.current = null;
        audioRef.current.src = url;
        
        console.log('🔄 Starting audio load');
        await audioRef.current.load();
        console.log('✅ Audio file loaded successfully:', {
          duration: audioRef.current.duration,
          readyState: audioRef.current.readyState
        });
      } catch (error) {
        console.error('❌ Audio load error:', {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
        throw error;
      }
    } else {
      console.log('ℹ️ Audio file already loaded:', {
        src: audioRef.current.src,
        readyState: audioRef.current.readyState
      });
    }
  };

  const togglePlay = async () => {
    console.log('🎵 Toggle play clicked');
    console.log('Current player state:', { 
      isPlaying, 
      currentFragment, 
      fragmentsCount: fragments.length,
      isWaitingForNext,
      currentTime: audioRef.current?.currentTime,
      duration: currentDurationRef.current,
      audioSrc: audioRef.current?.src,
      readyState: audioRef.current?.readyState
    });

    try {
      if (!await checkBackendAvailability()) {
        console.error('❌ Backend not available for playback');
        throw new Error('Backend is not available');
      }

      if (isPlaying || isWaitingForNext) {
        await pausePlayback();
      } else {
        await startPlayback();
      }
    } catch (error) {
      console.error('❌ Playback toggle error:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        playerState: {
          isPlaying,
          isLoading,
          currentFragment,
          fragmentsCount: fragments.length
        }
      });
      setError('Failed to toggle playback: ' + error.message);
      setIsPlaying(false);
      setIsLoading(false);
    }
  };

  const pausePlayback = async () => {
    console.log('⏸️ Pausing playback:', {
      currentTime: audioRef.current?.currentTime,
      duration: audioRef.current?.duration,
      readyState: audioRef.current?.readyState
    });

    try {
      await audioRef.current?.pause();
      setIsPlaying(false);
      setIsWaitingForNext(false);
      setIsLoading(false);
      
      if (nextFragmentCheckRef.current) {
        console.log('🧹 Clearing fragment check interval');
        clearInterval(nextFragmentCheckRef.current);
      }
      
      console.log('✅ Playback paused successfully');
    } catch (error) {
      console.error('❌ Error pausing playback:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  };

  const startPlayback = async () => {
    console.log('▶️ Starting playback:', {
      currentFragment,
      fragmentsCount: fragments.length,
      audioSrc: audioRef.current?.src
    });

    setupAudioElement();
    
    const hasValidTime = audioRef.current?.currentTime !== undefined && 
                       currentDurationRef.current && 
                       !audioRef.current.error;
                       
    const wasAtEnd = hasValidTime && (currentTime >= (currentDurationRef.current - 0.1));
    const hasNewFragments = currentFragment + 1 < fragments.length;

    console.log('Playback state analysis:', {
      hasValidTime,
      wasAtEnd,
      hasNewFragments,
      currentTime,
      duration: currentDurationRef.current,
      readyState: audioRef.current?.readyState,
      networkState: audioRef.current?.networkState
    });

    if (wasAtEnd && !hasNewFragments) {
      console.log('⌛ At end of fragment, waiting for new ones:', {
        currentFragment,
        fragmentsAvailable: fragments.length
      });
      setIsWaitingForNext(true);
      setIsLoading(true);
      startFragmentPolling();
      return;
    } else if (wasAtEnd && hasNewFragments) {
      console.log('📥 Moving to next available fragment:', {
        current: currentFragment,
        next: currentFragment + 1,
        totalFragments: fragments.length
      });
      setCurrentFragment(currentFragment + 1);
      setIsWaitingForNext(false);
      setIsLoading(false);
      setIsPlaying(true);
      return;
    }

    try {
      if (!audioRef.current.src || audioRef.current.error) {
        console.log('🔄 Loading audio file:', {
          currentSrc: audioRef.current.src,
          hasError: !!audioRef.current.error
        });
        await loadAudio();
      }
      
      console.log('▶️ Starting audio playback');
      await audioRef.current.play();
      console.log('✅ Playback started successfully:', {
        currentTime: audioRef.current.currentTime,
        duration: audioRef.current.duration,
        readyState: audioRef.current.readyState
      });
      setIsPlaying(true);
    } catch (error) {
      console.error('❌ Playback start error:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        audioState: {
          src: audioRef.current?.src,
          readyState: audioRef.current?.readyState,
          networkState: audioRef.current?.networkState
        }
      });
      throw error;
    }
  };

  // Effect: Initial fragment loading and polling
  useEffect(() => {
    console.log('🔄 Setting up fragment polling:', {
      videoId,
      language,
      isUnmounting: isUnmountingRef.current
    });

    const checkFragments = async () => {
      if (isUnmountingRef.current) {
        console.log('⚠️ Skipping fragment check - component unmounting');
        return;
      }
      await checkForNewFragments();
    };

    checkFragments();
    const interval = setInterval(checkFragments, POLLING_INTERVALS.FRAGMENT_CHECK);
    console.log('✅ Fragment polling interval set:', interval);

    return () => {
      console.log('🧹 Cleaning up audio player:', {
        videoId,
        language,
        hasAudioRef: !!audioRef.current,
        hasInterval: !!interval
      });
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

  // Effect: Handle fragment changes
  useEffect(() => {
    console.log('🔄 Fragment changed:', {
      currentFragment,
      totalFragments: fragments.length,
      isPlaying,
      isWaitingForNext
    });

    const loadAndPlay = async () => {
      try {
        if (isPlaying || (!isPlaying && !isWaitingForNext)) {
          const currentUrl = audioRef.current?.src;
          const newUrl = `${API_BASE_URL}/api/audio/${videoId}/${language}/${fragments[currentFragment]}`;
          
          console.log('URL comparison:', {
            current: currentUrl,
            new: newUrl,
            needsUpdate: currentUrl !== newUrl
          });

          if (currentUrl !== newUrl) {
            await loadAudio();
            if (isPlaying) {
              console.log('▶️ Auto-playing next fragment');
              try {
                await audioRef.current?.play();
                console.log('✅ Auto-play successful');
              } catch (error) {
                console.error('❌ Auto-play failed:', {
                  name: error.name,
                  message: error.message,
                  stack: error.stack
                });
                setIsPlaying(false);
              }
            }
          }
        }
      } catch (error) {
        console.error('❌ Fragment change error:', {
          name: error.name,
          message: error.message,
          stack: error.stack,
          fragmentState: {
            current: currentFragment,
            total: fragments.length,
            isPlaying,
            isWaitingForNext
          }
        });
        setError('Failed to play audio');
        setIsPlaying(false);
      }
    };

    loadAndPlay();
  }, [currentFragment]);

  // Effect: Handle play state changes
  useEffect(() => {
    console.log('🔄 Play state changed:', {
      isPlaying,
      currentFragment,
      hasAudioRef: !!audioRef.current,
      audioError: audioRef.current?.error
    });

    const handlePlayStateChange = async () => {
      try {
        if (isPlaying && audioRef.current && !audioRef.current.error) {
          if (audioRef.current.paused) {
            console.log('▶️ Resuming playback:', {
              currentTime: audioRef.current.currentTime,
              duration: audioRef.current.duration,
              readyState: audioRef.current.readyState
            });
            
            try {
              await audioRef.current.play();
              console.log('✅ Resume successful');
            } catch (error) {
              console.error('❌ Resume failed:', {
                name: error.name,
                message: error.message,
                stack: error.stack
              });
              setIsPlaying(false);
            }
          }
        }
      } catch (error) {
        console.error('❌ Play state change error:', {
          name: error.name,
          message: error.message,
          stack: error.stack,
          audioState: {
            paused: audioRef.current?.paused,
            readyState: audioRef.current?.readyState,
            networkState: audioRef.current?.networkState
          }
        });
        setError('Failed to play audio');
        setIsPlaying(false);
      }
    };

    handlePlayStateChange();
  }, [isPlaying]);

  // Effect: Handle volume changes
  useEffect(() => {
    console.log('🔊 Volume changed:', {
      newVolume: volume,
      hasAudioRef: !!audioRef.current,
      currentVolume: audioRef.current?.volume
    });
    
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  return {
    isPlaying,
    isLoading,
    currentFragment,
    fragments,
    error,
    volume,
    currentTime,
    isWaitingForNext,
    setVolume,
    setError,
    togglePlay
  };
} 