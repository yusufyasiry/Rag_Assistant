//Imports and Libraries
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Clock, AlertCircle, FileText, Database, Plus, MessageCircle, Trash2, Mic, MicOff, Settings, Volume2, VolumeX, Loader2} from 'lucide-react';
import axios from 'axios'; // api call
import './App.css';
import DocumentUploadPanel from './DocumentUpload.js';

const DocumentAssistant = () => {
  const [conversations, setConversations] = useState([]); // all convs
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]); // curent conv messages
  const [query, setQuery] = useState(''); // user query
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  // Voice Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState('auto');
  const [detectedLanguage, setDetectedLanguage] = useState(null);
  const [confidence, setConfidence] = useState(0);
  
  // Enhanced TTS states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [currentSpeechId, setCurrentSpeechId] = useState(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [ttsSettings, setTtsSettings] = useState({
    enabled: true,
    autoSpeak: false,
    voice: 'nova',
    language: 'auto'
  });

  // Audio management refs
  const audioRef = useRef(null);
  const abortControllerRef = useRef(null);
  const currentTextRef = useRef('');
  const chunksQueueRef = useRef([]);
  const isPlayingChunksRef = useRef(false);

  // Simplified auto-stop detection refs
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneRef = useRef(null);
  const audioStreamRef = useRef(null);
  const monitoringIntervalRef = useRef(null);
  const autoStopTimeoutRef = useRef(null);
  const recordingStartTimeRef = useRef(0);
  const lastSpeechTimeRef = useRef(0);
  const speechDetectedRef = useRef(false);

  // Simplified and more reliable constants
  const SILENCE_THRESHOLD = 1500; // 1.5 seconds of silence to auto-stop
  const MIN_RECORDING_TIME = 800; // Minimum 0.8 seconds before allowing auto-stop
  const ENERGY_THRESHOLD = 0.005; // Simplified energy threshold
  const MIN_AUDIO_SIZE = 2000; // Minimum audio size in bytes (to avoid empty recordings)

  // Voice settings modal
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // Refs for auto-scrolling
  const messagesEndRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  
  // API base URL
  const API_BASE_URL = process.env.REACT_APP_API_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://rag-assistant-gilv.onrender.com' 
      : 'http://127.0.0.1:8000');
  const USER_ID = 'user123';

  // Initialize voice capabilities
  useEffect(() => {
    initializeVoiceCapabilities();
    initializeAudioPlayer();
    
    return () => {
      cleanup();
    };
  }, []);

  const initializeVoiceCapabilities = async () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
      setVoiceSupported(true);
    }
  };

  const initializeAudioPlayer = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      
      audioRef.current.onloadstart = () => {
        console.log('Audio loading started');
        setIsLoadingAudio(true);
      };

      audioRef.current.oncanplay = () => {
        console.log('Audio can start playing');
        setIsLoadingAudio(false);
      };

      audioRef.current.onplay = () => {
        console.log('Audio started playing');
        setIsSpeaking(true);
        setIsLoadingAudio(false);
      };

      audioRef.current.onended = () => {
        console.log('Audio chunk ended');
        setIsLoadingAudio(false);
        
        // Check if there are more chunks to play
        if (isPlayingChunksRef.current && chunksQueueRef.current.length > 0) {
          playNextChunk();
        } else {
          // All chunks completed
          setIsSpeaking(false);
          setCurrentSpeechId(null);
          setCurrentChunkIndex(0);
          setTotalChunks(0);
          isPlayingChunksRef.current = false;
          chunksQueueRef.current = [];
        }
      };
      
      audioRef.current.onerror = (error) => {
        console.error('Audio playback error:', error);
        setIsLoadingAudio(false);
        
        // Don't show error immediately if we're just loading
        setTimeout(() => {
          if (!audioRef.current?.src || audioRef.current.readyState === 0) {
            return; // Still loading, don't show error
          }
          setError('Audio playback failed');
          setIsSpeaking(false);
          setCurrentSpeechId(null);
          isPlayingChunksRef.current = false;
        }, 2000); // Give 2 seconds for loading before showing error
      };

      audioRef.current.onpause = () => {
        console.log('Audio paused');
        setIsSpeaking(false);
      };

      // Handle loading states better
      audioRef.current.onwaiting = () => {
        console.log('Audio waiting for data');
        setIsLoadingAudio(true);
      };

      audioRef.current.onplaying = () => {
        console.log('Audio playing');
        setIsLoadingAudio(false);
        setIsSpeaking(true);
      };
    }
  };

  // Simplified and more reliable audio monitoring
  const startAudioMonitoring = (stream) => {
    try {
      // Create audio context and analyser
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      
      // Configure analyser for speech detection
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.2;
      
      microphone.connect(analyser);
      
      // Store references
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      microphoneRef.current = microphone;
      audioStreamRef.current = stream;
      
      // Reset detection variables
      lastSpeechTimeRef.current = Date.now();
      speechDetectedRef.current = false;
      recordingStartTimeRef.current = Date.now();
      
      console.log('Audio monitoring started');
      
      // Start monitoring with interval
      monitoringIntervalRef.current = setInterval(() => {
        if (!isRecording || !analyserRef.current) {
          clearInterval(monitoringIntervalRef.current);
          return;
        }
        
        checkForSpeech();
      }, 100); // Check every 100ms
      
    } catch (error) {
      console.error('Error starting audio monitoring:', error);
      setError('Failed to setup audio monitoring');
    }
  };

  const checkForSpeech = () => {
    if (!analyserRef.current || !isRecording) return;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // Calculate average energy
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += (dataArray[i] / 255) * (dataArray[i] / 255);
    }
    const averageEnergy = Math.sqrt(sum / bufferLength);
    
    const currentTime = Date.now();
    const recordingDuration = currentTime - recordingStartTimeRef.current;
    
    // Check if current energy indicates speech
    const isSpeaking = averageEnergy > ENERGY_THRESHOLD;
    
    if (isSpeaking) {
      lastSpeechTimeRef.current = currentTime;
      if (!speechDetectedRef.current) {
        speechDetectedRef.current = true;
        console.log('Speech detected, energy:', averageEnergy.toFixed(4));
      }
      
      // Clear any pending auto-stop
      if (autoStopTimeoutRef.current) {
        clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
      }
    } else {
      // Check for silence conditions
      const silenceDuration = currentTime - lastSpeechTimeRef.current;
      
      // Only auto-stop if:
      // 1. We've been recording for minimum time
      // 2. We detected speech before
      // 3. We've had silence for the required duration
      // 4. No pending auto-stop timeout
      if (recordingDuration > MIN_RECORDING_TIME && 
          speechDetectedRef.current && 
          silenceDuration > SILENCE_THRESHOLD && 
          !autoStopTimeoutRef.current) {
        
        console.log(`Auto-stopping after ${silenceDuration}ms of silence`);
        
        // Set a small timeout to prevent multiple rapid auto-stops
        autoStopTimeoutRef.current = setTimeout(() => {
          if (isRecording && mediaRecorderRef.current) {
            console.log('Executing auto-stop');
            stopRecording(true); // true indicates auto-stop
          }
        }, 100);
      }
    }
  };

  const cleanupAudioMonitoring = () => {
    console.log('Cleaning up audio monitoring');
    
    // Clear monitoring interval
    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current);
      monitoringIntervalRef.current = null;
    }
    
    // Clear auto-stop timeout
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    
    // Disconnect and close audio context
    if (microphoneRef.current) {
      try {
        microphoneRef.current.disconnect();
      } catch (e) {
        console.warn('Error disconnecting microphone:', e);
      }
      microphoneRef.current = null;
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (e) {
        console.warn('Error closing audio context:', e);
      }
      audioContextRef.current = null;
    }
    
    // Stop all audio tracks
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Error stopping audio track:', e);
        }
      });
      audioStreamRef.current = null;
    }
    
    // Reset detection state
    analyserRef.current = null;
    speechDetectedRef.current = false;
    lastSpeechTimeRef.current = 0;
    recordingStartTimeRef.current = 0;
  };

  // Fast chunked TTS with immediate start and auto language detection
  const speakText = async (text, messageId = null) => {
    if (!ttsSettings.enabled || !text.trim()) return;

    // Stop any ongoing speech
    stopSpeaking();

    try {
      setCurrentSpeechId(messageId);
      setIsLoadingAudio(true);
      currentTextRef.current = text;
      
      // Abort any previous requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      console.log('Starting chunked TTS for text length:', text.length);
      console.log('TTS Settings:', ttsSettings);

      // Prepare TTS request - let backend auto-detect language if set to 'auto'
      const ttsRequestBody = {
        text: text,
        voice: ttsSettings.voice,
      };

      // Only send language if it's not 'auto' - let backend handle auto-detection
      if (ttsSettings.language && ttsSettings.language !== 'auto') {
        ttsRequestBody.language = ttsSettings.language;
        console.log('Using specified language:', ttsSettings.language);
      } else {
        console.log('Using auto language detection');
        // Don't send language parameter - backend will auto-detect
      }

      // Get first chunk immediately to start playing
      const response = await fetch(`${API_BASE_URL}/voice/text-to-speech/chunk/0`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsRequestBody),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('TTS response error:', response.status, errorText);
        throw new Error(`TTS request failed: ${response.status} - ${errorText}`);
      }

      // Get chunk info from headers
      const totalChunksHeader = response.headers.get('X-Total-Chunks');
      const currentChunkHeader = response.headers.get('X-Current-Chunk');
      
      const totalChunksCount = parseInt(totalChunksHeader) || 1;
      const currentChunk = parseInt(currentChunkHeader) || 0;
      
      setTotalChunks(totalChunksCount);
      setCurrentChunkIndex(currentChunk);

      console.log(`Got chunk ${currentChunk} of ${totalChunksCount}`);

      // Play first chunk immediately
      const firstAudioBlob = await response.blob();
      
      if (abortControllerRef.current?.signal.aborted) return;

      const audioUrl = URL.createObjectURL(firstAudioBlob);
      audioRef.current.src = audioUrl;
      
      // Start playing first chunk
      try {
        await audioRef.current.play();
        
        // If there are more chunks, start fetching them in parallel
        if (totalChunksCount > 1) {
          isPlayingChunksRef.current = true;
          fetchRemainingChunks(text, totalChunksCount);
        }
        
      } catch (playError) {
        console.error('Error playing first chunk:', playError);
        URL.revokeObjectURL(audioUrl);
        throw playError;
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('TTS request was cancelled');
        return;
      }
      
      console.error('TTS error:', error);
      setError(`Text-to-speech failed: ${error.message}`);
      setIsSpeaking(false);
      setCurrentSpeechId(null);
      setIsLoadingAudio(false);
    }
  };

  // Fetch remaining chunks in background
  const fetchRemainingChunks = async (text, totalChunks) => {
    try {
      // Fetch chunks 1 through totalChunks-1
      const chunkPromises = [];
      
      for (let i = 1; i < totalChunks; i++) {
        const chunkPromise = fetch(`${API_BASE_URL}/voice/text-to-speech/chunk/${i}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text,
            language: ttsSettings.language === 'auto' ? null : ttsSettings.language,
            voice: ttsSettings.voice,
          }),
          signal: abortControllerRef.current?.signal
        }).then(response => {
          if (!response.ok) throw new Error(`Chunk ${i} failed`);
          return response.blob();
        });
        
        chunkPromises.push(chunkPromise);
      }

      // Wait for all chunks
      const chunkBlobs = await Promise.all(chunkPromises);
      
      if (abortControllerRef.current?.signal.aborted) return;

      // Convert to URLs and queue them
      chunksQueueRef.current = chunkBlobs.map(blob => URL.createObjectURL(blob));
      
      console.log(`Fetched ${chunksQueueRef.current.length} additional chunks`);
      
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Error fetching chunks:', error);
    }
  };

  // Play next chunk from queue
  const playNextChunk = () => {
    if (chunksQueueRef.current.length === 0) {
      // No more chunks, finish
      setIsSpeaking(false);
      setCurrentSpeechId(null);
      isPlayingChunksRef.current = false;
      return;
    }

    const nextChunkUrl = chunksQueueRef.current.shift();
    setCurrentChunkIndex(prev => prev + 1);
    
    // Clean up previous URL
    if (audioRef.current.src) {
      URL.revokeObjectURL(audioRef.current.src);
    }
    
    audioRef.current.src = nextChunkUrl;
    audioRef.current.play().catch(error => {
      console.error('Error playing next chunk:', error);
      URL.revokeObjectURL(nextChunkUrl);
    });
  };

  const stopSpeaking = () => {
    console.log('Stopping speech');
    
    // Abort any ongoing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Stop audio and cleanup
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      
      // Clean up object URL
      if (audioRef.current.src) {
        URL.revokeObjectURL(audioRef.current.src);
        audioRef.current.src = '';
      }
    }
    
    // Clean up queued chunks
    chunksQueueRef.current.forEach(url => URL.revokeObjectURL(url));
    chunksQueueRef.current = [];
    isPlayingChunksRef.current = false;
    
    setIsSpeaking(false);
    setIsLoadingAudio(false);
    setCurrentSpeechId(null);
    setCurrentChunkIndex(0);
    setTotalChunks(0);
  };

  const handleSpeakMessage = (message) => {
    if (currentSpeechId === message.id) {
      stopSpeaking();
    } else {
      speakText(message.content, message.id);
    }
  };

  const testVoice = () => {
    const testText = "Hello! This is a test of the text-to-speech functionality. How does it sound?";
    speakText(testText, 'test');
  };

  // Auto-speak new assistant messages if enabled
  useEffect(() => {
    if (ttsSettings.autoSpeak && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === 'assistant' && !lastMessage.hasBeenSpoken) {
        setMessages(prev => prev.map(msg => 
          msg.id === lastMessage.id 
            ? { ...msg, hasBeenSpoken: true }
            : msg
        ));
        
        setTimeout(() => {
          speakText(lastMessage.content, lastMessage.id);
        }, 500);
      }
    }
  }, [messages, ttsSettings.autoSpeak]);

  const cleanup = () => {
    cleanupAudioMonitoring();
    stopSpeaking();
  };

  // Enhanced MediaRecorder-based voice recording with reliable auto-stop
  const startRecording = async () => {
    try {
      stopSpeaking();
      
      // Request microphone access with specific constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1
        } 
      });
      
      // Validate that we have a proper audio stream
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0 || audioTracks[0].readyState !== 'live') {
        throw new Error('No active audio track available');
      }
      
      console.log('Audio track settings:', audioTracks[0].getSettings());
      
      // Create MediaRecorder with optimal settings
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      ];
      
      let selectedMimeType = '';
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }
      
      if (!selectedMimeType) {
        throw new Error('No supported audio format found');
      }
      
      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        bitsPerSecond: 128000
      });
      
      const chunks = [];
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          console.log('Audio chunk received:', event.data.size, 'bytes');
        }
      };
      
      recorder.onstop = async () => {
        console.log('MediaRecorder stopped');
        
        // Calculate total audio size
        const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log('Total recorded audio size:', totalSize, 'bytes');
        
        // Clean up monitoring first
        cleanupAudioMonitoring();
        
        // Validate audio size - if too small, likely no meaningful speech
        if (totalSize < MIN_AUDIO_SIZE) {
          console.log('Audio too small, likely no speech detected');
          setError('No speech detected. Please speak clearly into the microphone.');
          setIsRecording(false);
          setMediaRecorder(null);
          return;
        }
        
        // Create audio blob and process
        const audioBlob = new Blob(chunks, { type: selectedMimeType });
        console.log('Created audio blob:', audioBlob.size, 'bytes, type:', audioBlob.type);
        
        // Reset states
        setIsRecording(false);
        setMediaRecorder(null);
        
        // Process the audio
        await transcribeAndSend(audioBlob);
      };
      
      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
        cleanupAudioMonitoring();
        setError('Recording error occurred');
        setIsRecording(false);
        setMediaRecorder(null);
      };
      
      // Store recorder reference
      mediaRecorderRef.current = recorder;
      
      // Start recording
      recorder.start(100); // Collect data every 100ms for better audio continuity
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
      setError(null);
      
      // Start audio monitoring for auto-stop
      startAudioMonitoring(stream);
      
      console.log('Recording started with format:', selectedMimeType);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      cleanupAudioMonitoring();
      
      if (error.name === 'NotAllowedError') {
        setError('Microphone access denied. Please allow microphone permissions.');
      } else if (error.name === 'NotFoundError') {
        setError('No microphone found. Please check your audio devices.');
      } else {
        setError(`Could not access microphone: ${error.message}`);
      }
      
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  const stopRecording = (isAutoStop = false) => {
    console.log(`${isAutoStop ? 'Auto-' : 'Manual '}stopping recording...`);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.error('Error stopping MediaRecorder:', error);
        // Force cleanup if stop fails
        cleanupAudioMonitoring();
        setIsRecording(false);
        setMediaRecorder(null);
      }
    } else {
      // If MediaRecorder is not in recording state, force cleanup
      cleanupAudioMonitoring();
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  const transcribeAndSend = async (audioBlob) => {
    setIsTranscribing(true);
    
    try {
      console.log('Starting transcription for audio blob:', audioBlob.size, 'bytes');
      
      const formData = new FormData();
      formData.append('audio_file', audioBlob, 'recording.' + (audioBlob.type.includes('webm') ? 'webm' : 'wav'));
      
      if (voiceLanguage && voiceLanguage !== 'auto') {
        formData.append('language', voiceLanguage);
      }
      
      const response = await axios.post(`${API_BASE_URL}/voice/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000 // 30 second timeout
      });
      
      const { text, confidence: voiceConfidence, language, auto_detected } = response.data;
      console.log('Transcription result:', { text, confidence: voiceConfidence, language });
      
      if (text && text.trim()) {
        // Filter out common noise/silence transcriptions
        const noisePatterns = [
          /thanks for watching/i,
          /please subscribe/i,
          /like and comment/i,
          /don't forget to/i,
          /see you next time/i,
          /bye bye/i,
          /thank you/i,
          /^\s*\.\s*$/,
          /^\s*\?\s*$/,
          /^\s*!\s*$/
        ];
        
        const isNoise = noisePatterns.some(pattern => pattern.test(text.trim()));
        
        if (isNoise) {
          console.log('Detected noise/filler text, ignoring:', text);
          setError('Only background noise detected. Please try speaking more clearly.');
          return;
        }
        
        if (auto_detected && language) {
          setDetectedLanguage(language);
        }
        
        if (voiceConfidence) {
          setConfidence(voiceConfidence);
        }
        
        // Clear any existing query to avoid duplication
        setQuery('');
        
        // Auto-send the message directly
        setTimeout(() => {
          handleSearchWithText(text, voiceConfidence);
        }, 100);
        
      } else {
        setError('No speech detected in the recording. Please speak more clearly.');
      }
      
    } catch (error) {
      console.error('Transcription error:', error);
      
      if (error.code === 'ECONNABORTED') {
        setError('Transcription timed out. Please try again with a shorter recording.');
      } else {
        const errorMessage = error.response?.data?.detail || 'Failed to transcribe audio';
        setError(`Transcription failed: ${errorMessage}`);
      }
    } finally {
      setIsTranscribing(false);
      setConfidence(0);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording(false); // Manual stop
    } else {
      startRecording();
    }
  };

  // Auto-scroll functions
  const scrollToBottom = useCallback(() => {
    if (shouldAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'smooth',
        block: 'end'
      });
    }
  }, [shouldAutoScroll]);

  const scrollToBottomImmediate = useCallback(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (chatMessagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatMessagesRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShouldAutoScroll(isNearBottom);
    }
  }, []);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  };

  // Load user's conversations on component mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.conversation_id);
    } else {
      setMessages([]);
    }
  }, [currentConversation]);

  // Auto-scroll when messages change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      scrollToBottom();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [messages, scrollToBottom]);

  // Auto-scroll when starting to search
  useEffect(() => {
    if (isSearching) {
      setShouldAutoScroll(true);
      setTimeout(scrollToBottomImmediate, 50);
    }
  }, [isSearching, scrollToBottomImmediate]);

  const loadConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations`, {
        params: { user_id: USER_ID }
      });
      setConversations(response.data.conversations);
      
      if (!currentConversation && response.data.conversations.length > 0) {
        setCurrentConversation(response.data.conversations[0]);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setError('Failed to load conversations');
    } finally {
      setIsLoadingConversations(false);
    }
  };

const loadMessages = async (conversationId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/conversations/${conversationId}/messages`);
    const backendMessages = response.data.messages;
    
    const frontendMessages = backendMessages.map(msg => {
      const mappedMessage = {
        id: msg._id || msg.message_id,
        type: msg.role,
        content: msg.content,
        sources: [], // Initialize empty
        timestamp: new Date(msg.timestamp),
        voiceMetadata: msg.voice_metadata,
        hasBeenSpoken: true
      };

      // Handle sources more robustly
      if (msg.sources && Array.isArray(msg.sources) && msg.sources.length > 0) {
        mappedMessage.sources = msg.sources.map((chunk, index) => {
          // Handle different source formats
          if (typeof chunk === 'object' && chunk !== null) {
            // If it's already a formatted source object
            if (chunk.name && chunk.snippet) {
              return chunk;
            }
            // If it's an object but not formatted, try to extract text
            const chunkText = chunk.content || chunk.text || JSON.stringify(chunk);
            return {
              name: `Source ${index + 1}`,
              snippet: chunkText.length > 150 ? chunkText.substring(0, 150) + "..." : chunkText
            };
          } else {
            // Handle string chunks
            const chunkText = String(chunk || '');
            if (chunkText.trim()) {  // Only add non-empty sources
              return {
                name: `Source ${index + 1}`,
                snippet: chunkText.length > 150 ? chunkText.substring(0, 150) + "..." : chunkText
              };
            }
            return null;
          }
        }).filter(Boolean); // Remove null entries
      }

      return mappedMessage;
    });
    
    setMessages(frontendMessages);
    setShouldAutoScroll(true);
  } catch (error) {
    console.error('Failed to load messages:', error);
    setError('Failed to load conversation history');
  }
};

  const createNewConversation = async (firstMessage = null) => {
    try {
      const title = firstMessage ? 
        (firstMessage.length > 30 ? firstMessage.substring(0, 30) + "..." : firstMessage) :
        'New Chat';
        
      const response = await axios.post(`${API_BASE_URL}/conversations`, {
        title: title,
        user_id: USER_ID
      });
      
      const newConversation = response.data.conversation;
      setConversations(prev => [newConversation, ...prev]);
      setCurrentConversation(newConversation);
      setMessages([]);
      setError(null);
      setShouldAutoScroll(true);
      
      return newConversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      setError('Failed to create new conversation');
      return null;
    }
  };

  const deleteConversation = async (conversationId) => {
    try {
      await axios.delete(`${API_BASE_URL}/conversations/${conversationId}`);
      
      setConversations(prev => prev.filter(conv => conv.conversation_id !== conversationId));
      
      if (currentConversation && currentConversation.conversation_id === conversationId) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      setError('Failed to delete conversation');
    }
  };

  // Enhanced handleSearch that can accept text and confidence parameters
  const handleSearchWithText = async (searchText = null, voiceConfidence = null) => {
    const queryText = searchText || query;
    if (!queryText.trim()) return;

    // Don't clear query if we're using searchText from voice input
    if (!searchText) {
      setQuery('');
    }
    
    let targetConversation = currentConversation;
    
    if (!targetConversation) {
      targetConversation = await createNewConversation(queryText);
      if (!targetConversation) {
        setError('Failed to create conversation');
        return;
      }
    }

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: queryText,
      timestamp: new Date(),
      voiceMetadata: (voiceConfidence || confidence) > 0 ? { confidence: voiceConfidence || confidence } : null
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsSearching(true);
    setError(null);
    setShouldAutoScroll(true);
    
    // Clear confidence after using
    setConfidence(0);
    
    try {
      const response = await axios.post(`${API_BASE_URL}/chat/${targetConversation.conversation_id}`, {
        conversation_id: targetConversation.conversation_id,
        question: queryText,
        is_voice_input: (voiceConfidence || confidence) > 0,
        voice_confidence: (voiceConfidence || confidence) > 0 ? (voiceConfidence || confidence) : null
      });
      
      const apiResult = response.data;
      
      const assistantMessage = {
        id: Date.now() + 1,
        type: 'assistant',
        content: apiResult.answer,
        sources: apiResult.chunks.map((chunk, index) => ({
          name: `Source ${index + 1}`,
          snippet: chunk.length > 150 ? chunk.substring(0, 150) + "..." : chunk
        })),
        timestamp: new Date(),
        hasBeenSpoken: false
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
      setCurrentConversation(prev => ({
        ...prev,
        message_count: (prev.message_count || 0) + 2,
        updated_at: new Date().toISOString()
      }));
      
      setConversations(prev => prev.map(conv => 
        conv.conversation_id === targetConversation.conversation_id
          ? {
              ...conv,
              message_count: (conv.message_count || 0) + 2,
              updated_at: new Date().toISOString()
            }
          : conv
      ));
      
    } catch (error) {
      console.error('Chat error:', error);
      
      const errorMessage = error.response?.data?.detail || 'Failed to get response. Please try again.';
      setError(errorMessage);
      
      const errorResponse = {
        id: Date.now() + 1,
        type: 'error',
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsSearching(false);
    }
  };

  // Original handleSearch function for backwards compatibility
  const handleSearch = async () => {
    await handleSearchWithText();
  };

  const selectConversation = (conversation) => {
    setCurrentConversation(conversation);
    setError(null);
    setShouldAutoScroll(true);
    stopSpeaking();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSearching) {
      e.preventDefault();
      handleSearch();
    }
  };

  const getLanguageName = (languageCode) => {
    const languageNames = {
      'en': 'English',
      'tr': 'Türkçe',
      'de': 'Deutsch',
      'fr': 'Français',
      'es': 'Español',
      'it': 'Italiano',
      'pt': 'Português',
      'ru': 'Русский',
      'ja': '日本語',
      'ko': '한국어',
      'zh': '中文',
      'ar': 'العربية',
      'hi': 'हिन्दी'
    };
    return languageNames[languageCode] || languageCode;
  };

  // Voice Settings Modal Component
  const VoiceSettingsModal = () => (
    <div className="voice-settings-modal" style={{ display: showVoiceSettings ? 'flex' : 'none' }}>
      <div className="voice-settings-content">
        <div className="voice-settings-header">
          <h3>Voice Settings</h3>
          <button onClick={() => setShowVoiceSettings(false)} className="close-button">×</button>
        </div>
        
        <div className="voice-settings-body">
          {/* Voice Input Section */}
          <div className="setting-section">
            <h4>Voice Input</h4>
            
            <div className="setting-group">
              <label>Recognition Language</label>
              <select 
                value={voiceLanguage} 
                onChange={(e) => setVoiceLanguage(e.target.value)}
                className="setting-select"
              >
                <option value="auto">Auto-detect (Recommended)</option>
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
              <small className="setting-help">
                Uses Whisper API for high accuracy transcription with automatic speech detection and message sending.
              </small>
            </div>
          </div>

          {/* Text-to-Speech Section */}
          <div className="setting-section">
            <h4>Text-to-Speech</h4>
            
            <div className="setting-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={ttsSettings.enabled}
                  onChange={(e) => setTtsSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                />
                Enable Text-to-Speech
              </label>
            </div>

            <div className="setting-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={ttsSettings.autoSpeak}
                  onChange={(e) => setTtsSettings(prev => ({ ...prev, autoSpeak: e.target.checked }))}
                  disabled={!ttsSettings.enabled}
                />
                Auto-speak assistant responses
              </label>
              <small className="setting-help">
                Automatically read out loud new assistant messages
              </small>
            </div>

            <div className="setting-group">
              <label>Voice Selection</label>
              <select 
                value={ttsSettings.voice} 
                onChange={(e) => setTtsSettings(prev => ({ ...prev, voice: e.target.value }))}
                className="setting-select"
                disabled={!ttsSettings.enabled}
              >
                <option value="alloy">Alloy (Neutral)</option>
                <option value="echo">Echo (Male)</option>
                <option value="fable">Fable (British Male)</option>
                <option value="onyx">Onyx (Deep Male)</option>
                <option value="nova">Nova (Female)</option>
                <option value="shimmer">Shimmer (Soft Female)</option>
              </select>
              <small className="setting-help">
                Choose from OpenAI's high-quality TTS voices
              </small>
            </div>

            <div className="setting-group">
              <label>Speech Language</label>
              <select 
                value={ttsSettings.language} 
                onChange={(e) => setTtsSettings(prev => ({ ...prev, language: e.target.value }))}
                className="setting-select"
                disabled={!ttsSettings.enabled}
              >
                <option value="auto">Auto-detect from text</option>
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
              <small className="setting-help">
                Choose language for speech synthesis or let it auto-detect
              </small>
            </div>
          </div>
        </div>

        <div className="voice-settings-footer">
          <button 
            onClick={testVoice} 
            className="test-voice-button"
            disabled={!ttsSettings.enabled}
          >
            {isSpeaking && currentSpeechId === 'test' ? <VolumeX size={16} /> : <Volume2 size={16} />}
            {isSpeaking && currentSpeechId === 'test' ? 'Stop Test' : 'Test Voice'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-content">
            <div className="logo">
              <Database size={32} color="white" />
            </div>
            <h1 className="title"> Ecore Support Assistant</h1>
            <div className="header-controls">
              {/* Global speech control */}
              {isSpeaking && (
                <button 
                  onClick={stopSpeaking}
                  className="stop-speech-button"
                  title="Stop Speaking"
                >
                  <VolumeX size={20} />
                </button>
              )}
              <button 
                onClick={() => setShowVoiceSettings(true)}
                className="voice-settings-button"
                title="Voice Settings"
              >
                <Settings size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container">
        <div className="three-column-layout">
          
          {/* Left Sidebar - Conversations List */}
          <div className="left-sidebar">
            <div className="sidebar-header">
              <h3>Conversations</h3>
              <button 
                onClick={() => createNewConversation()} 
                className="new-chat-button"
                disabled={isLoadingConversations}
              >
                <Plus size={20} />
                New Chat
              </button>
            </div>
            
            <div className="conversations-list">
              {isLoadingConversations ? (
                <div className="loading-conversations">
                  <Clock size={16} className="animate-spin" />
                  <span>Loading...</span>
                </div>
              ) : conversations.length === 0 ? (
                <div className="no-conversations">
                  <MessageCircle size={32} color="#9ca3af" />
                  <p>No conversations yet</p>
                  <button 
                    onClick={() => createNewConversation()} 
                    className="create-first-chat"
                  >
                    Start your first chat
                  </button>
                </div>
              ) : (
                conversations.map((conversation) => (
                  <div
                    key={conversation.conversation_id}
                    className={`conversation-item ${
                      currentConversation?.conversation_id === conversation.conversation_id 
                        ? 'active' 
                        : ''
                    }`}
                    onClick={() => selectConversation(conversation)}
                  >
                    <div className="conversation-info">
                      <h4 className="conversation-title">{conversation.title}</h4>
                      <p className="conversation-date">
                        {formatDate(conversation.updated_at)}
                      </p>
                      <p className="conversation-messages">
                        {conversation.message_count || 0} messages
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Are you sure you want to delete this conversation?')) {
                          deleteConversation(conversation.conversation_id);
                        }
                      }}
                      className="delete-conversation"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Center - Chat Container */}
          <div className="center-chat">
            
            {/* Chat Header */}
            <div className="chat-header">
              <div>
                <h2 className="chat-title">
                  {currentConversation ? currentConversation.title : 'Ecore Support Assistant'}
                </h2>
                <p className="chat-subtitle">
                  {currentConversation 
                    ? `${messages.length} messages • ${formatDate(currentConversation.updated_at)}`
                    : 'Select a conversation or create a new one'
                  }
                </p>
              </div>
              <div className="chat-header-controls">
                {/* Voice status indicators */}
                <div className="voice-status">
                  {(isSpeaking || isLoadingAudio) && (
                    <span className="speaking-indicator">
                      {isLoadingAudio ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Loading audio...
                        </>
                      ) : (
                        <>
                          <Volume2 size={16} />
                          Speaking {totalChunks > 1 ? `(${currentChunkIndex + 1}/${totalChunks})` : ''}...
                        </>
                      )}
                    </span>
                  )}
                  {isRecording && (
                    <span className="listening-indicator">
                      <div className="pulse"></div>
                      {isTranscribing ? 'Transcribing...' : 'Recording...'}
                    </span>
                  )}
                </div>
                {currentConversation && (
                  <button 
                    onClick={() => createNewConversation()} 
                    className="new-chat-button-small"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Chat Messages */}
            <div 
              className="chat-messages"
              ref={chatMessagesRef}
              onScroll={handleScroll}
            >
              {!currentConversation ? (
                <div className="welcome-message">
                  <Database size={48} color="#9ca3af" />
                  <h3>Welcome to Ecore Support Assistant</h3>
                  <p>Upload your documents from top right corner and start chatting with them. You can use your files across multiple conversations.</p>
                  {voiceSupported && (
                    <p className="voice-hint">
                      <Mic size={16} />
                      Voice input is available! Click the microphone to start.
                    </p>
                  )}
                  {ttsSettings.enabled && (
                    <p className="voice-hint">
                      <Volume2 size={16} />
                      Text-to-speech enabled! Assistant responses can be read aloud.
                    </p>
                  )}
                  
                  <button 
                    onClick={() => createNewConversation()} 
                    className="start-chat-button"
                  >
                    <Plus size={20} />
                    Start New Chat
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="welcome-message">
                  <MessageCircle size={48} color="#9ca3af" />
                  <h3>Start the Conversation</h3>
                  <p>Upload your files from top right corner if you haven't already then ask me anything about your documents. I'll search through them and provide you with accurate answers.</p>
                  
                  {/* Quick suggestions */}
                  <div className="suggestions">
                    <p>Try asking:</p>
                    {['What is leasing ?', 'What are the advantages of leasing ?', 'Are there any tax benefits in leasing ?'].map((suggestion, index) => (
                      <button
                        key={index}
                        onClick={() => setQuery(suggestion)}
                        className="suggestion-chip"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className={`message ${message.type}`}>
                    <div className="message-content">
                      <div className="message-header">
                        <span className="message-sender">
                          {message.type === 'user' ? 'You' : message.type === 'error' ? 'Error' : 'Assistant'}
                        </span>
                        <div className="message-actions">
                          {/* Speak button for assistant messages */}
                          {message.type === 'assistant' && ttsSettings.enabled && (
                            <button
                              onClick={() => handleSpeakMessage(message)}
                              className="speak-message-button"
                              title={currentSpeechId === message.id ? 'Stop speaking' : 'Read message aloud'}
                              disabled={isLoadingAudio && currentSpeechId !== message.id}
                            >
                              {currentSpeechId === message.id ? (
                                isLoadingAudio ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <VolumeX size={14} />
                                )
                              ) : (
                                <Volume2 size={14} />
                              )}
                            </button>
                          )}
                          <span className="message-time">{formatTime(message.timestamp)}</span>
                        </div>
                      </div>
                      <div className="message-text">
                        {message.content}
                        {/* Speaking indicator for current message */}
                        {currentSpeechId === message.id && (
                          <div className="speaking-indicator-inline">
                            {isLoadingAudio ? (
                              <>
                                <Loader2 size={12} className="animate-spin" />
                                <span>Loading audio...</span>
                              </>
                            ) : (
                              <>
                                <Volume2 size={12} />
                                <span>Speaking {totalChunks > 1 ? `(${currentChunkIndex + 1}/${totalChunks})` : ''}...</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Show transcript confidence for user messages if they came from voice */}
                      {message.type === 'user' && message.voiceMetadata && message.voiceMetadata.confidence && (
                        <div className="voice-confidence">
                          Voice confidence: {Math.round(message.voiceMetadata.confidence * 100)}%
                        </div>
                      )}
                      
                      {/* Show sources for assistant messages */}
                      {message.type === 'assistant' && message.sources && message.sources.length > 0 && (
                        <div className="message-sources">
                          <h4>Sources:</h4>
                          {message.sources.map((source, index) => (
                            <div key={index} className="source-item">
                              <div className="source-header">
                                <FileText size={14} color="#6b7280" />
                                <span className="source-name">{source.name}</span>
                              </div>
                              <p className="source-snippet">"{source.snippet}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* Loading indicator */}
              {isSearching && (
                <div className="message assistant loading">
                  <div className="message-content">
                    <div className="message-header">
                      <span className="message-sender">Assistant</span>
                    </div>
                    <div className="typing-indicator">
                      <Clock size={16} color="#3b82f6" className="animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Invisible div for scrolling to bottom */}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="chat-input-container">
              {error && (
                <div className="error-message">
                  <AlertCircle size={16} color="#ef4444" />
                  <span>{error}</span>
                  <button 
                    onClick={() => setError(null)}
                    className="error-dismiss"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Transcribing indicator */}
              {isTranscribing && (
                <div className="transcript-preview">
                  <span className="transcript-label">Transcribing:</span>
                  <span className="transcript-text">
                    <Clock size={14} className="animate-spin" style={{ display: 'inline-block', marginRight: '8px' }} />
                    Processing audio...
                  </span>
                </div>
              )}
              
              <div className="chat-input-wrapper">
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    isRecording ? 
                      (isTranscribing ? "Transcribing audio..." : "Recording... Speak now") : 
                      "Ask anything about your documents or click the mic to speak..."
                  }
                  className={`chat-input ${isRecording ? 'listening' : ''}`}
                  onKeyDown={handleKeyPress}
                  disabled={isSearching || isTranscribing}
                  rows={1}
                  style={{
                    resize: 'none',
                    minHeight: '44px',
                    maxHeight: '120px',
                    overflow: 'auto'
                  }}
                />
                
                {/* Voice Controls */}
                <div className="voice-controls">
                  {/* Global stop speaking button (when speaking and not recording) */}
                  {(isSpeaking || isLoadingAudio) && !isRecording && (
                    <button
                      onClick={stopSpeaking}
                      className="stop-speech-button"
                      title="Stop speaking"
                    >
                      <VolumeX size={20} />
                    </button>
                  )}
                  
                  {/* Voice input button */}
                  {voiceSupported && (
                    <button
                      onClick={toggleRecording}
                      className={`voice-button ${isRecording ? 'listening' : ''}`}
                      title={isRecording ? 'Stop recording' : 'Start voice input (auto-detects when you stop)'}
                      disabled={isSearching || isTranscribing}
                    >
                      {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                  )}
                </div>

                <button
                  onClick={handleSearch}
                  disabled={isSearching || isTranscribing || !query.trim()}
                  className="send-button"
                >
                  <Search size={20} />
                </button>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Document Upload Panel */}
          <div className="right-sidebar">
            <DocumentUploadPanel />
          </div>
        </div>
      </div>

      {/* Voice Settings Modal */}
      <VoiceSettingsModal />
    </div>
  );
};

export default DocumentAssistant;