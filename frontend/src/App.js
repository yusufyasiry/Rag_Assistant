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
  
  // Web Speech API fallback states
  const [webSpeechSupported, setWebSpeechSupported] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [useWebSpeech, setUseWebSpeech] = useState(false);

  // Enhanced TTS states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [currentSpeechId, setCurrentSpeechId] = useState(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [ttsSettings, setTtsSettings] = useState({
    enabled: true,
    autoSpeak: false,
    voice: 'alloy',
    speed: 1.0,
    language: 'auto'
  });

  // Audio management refs
  const audioRef = useRef(null);
  const abortControllerRef = useRef(null);
  const currentTextRef = useRef('');
  const chunksQueueRef = useRef([]);
  const isPlayingChunksRef = useRef(false);

  // Voice settings modal
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // Refs for auto-scrolling
  const messagesEndRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Speech recognition ref for Web Speech API fallback
  const recognitionRef = useRef(null);
  
  // API base URL
  const API_BASE_URL = process.env.REACT_APP_API_URL;
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

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      setWebSpeechSupported(true);
      initializeWebSpeechAPI();
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
        speed: ttsSettings.speed,
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
            speed: ttsSettings.speed,
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

  const initializeWebSpeechAPI = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    
    const recognition = recognitionRef.current;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = `${voiceLanguage}-${voiceLanguage === 'en' ? 'US' : voiceLanguage === 'tr' ? 'TR' : 'US'}`;

    recognition.onstart = () => {
      setIsRecording(true);
      setError(null);
      stopSpeaking();
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
          setConfidence(event.results[i][0].confidence);
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        setQuery(prev => prev + finalTranscript);
        setTranscript('');
      } else {
        setTranscript(interimTranscript);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setError(`Voice recognition error: ${event.error}`);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      setTranscript('');
    };
  };

  // Update recognition language when voice language changes
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = `${voiceLanguage}-${voiceLanguage === 'en' ? 'US' : voiceLanguage === 'tr' ? 'TR' : 'US'}`;
    }
  }, [voiceLanguage]);

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
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    stopSpeaking();
  };

  // MediaRecorder-based voice recording
  const startRecording = async () => {
    try {
      stopSpeaking();
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const chunks = [];
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      
      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
        setAudioChunks([]);
      };
      
      recorder.start();
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
      setError(null);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setError('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob) => {
    setIsTranscribing(true);
    
    try {
      const formData = new FormData();
      formData.append('audio_file', audioBlob, 'recording.webm');
      
      if (voiceLanguage && voiceLanguage !== 'auto') {
        formData.append('language', voiceLanguage);
      }
      
      const response = await axios.post(`${API_BASE_URL}/voice/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      const { text, confidence, language, auto_detected } = response.data;
      
      if (text && text.trim()) {
        if (auto_detected && language) {
          setDetectedLanguage(language);
        }
        
        setQuery(prev => prev + text);
        if (confidence) {
          setConfidence(confidence);
        }
      }
      
    } catch (error) {
      console.error('Transcription error:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to transcribe audio';
      setError(`Transcription failed: ${errorMessage}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const startWebSpeechRecording = () => {
    if (recognitionRef.current && webSpeechSupported) {
      try {
        stopSpeaking();
        recognitionRef.current.start();
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        setError('Could not start voice recognition');
      }
    }
  };

  const stopWebSpeechRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      if (useWebSpeech) {
        stopWebSpeechRecording();
      } else {
        stopRecording();
      }
    } else {
      if (useWebSpeech) {
        startWebSpeechRecording();
      } else {
        startRecording();
      }
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

  const handleSearch = async () => {
    if (!query.trim()) return;

    const currentQuery = query;
    setQuery('');
    
    let targetConversation = currentConversation;
    
    if (!targetConversation) {
      targetConversation = await createNewConversation(currentQuery);
      if (!targetConversation) {
        setError('Failed to create conversation');
        return;
      }
    }

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: currentQuery,
      timestamp: new Date(),
      voiceMetadata: confidence > 0 ? { confidence } : null
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsSearching(true);
    setError(null);
    setShouldAutoScroll(true);
    
    setConfidence(0);
    
    try {
      const response = await axios.post(`${API_BASE_URL}/chat/${targetConversation.conversation_id}`, {
        conversation_id: targetConversation.conversation_id,
        question: currentQuery,
        is_voice_input: confidence > 0,
        voice_confidence: confidence > 0 ? confidence : null
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
              <label>Voice Input Method</label>
              <select 
                value={useWebSpeech ? 'webspeech' : 'whisper'} 
                onChange={(e) => setUseWebSpeech(e.target.value === 'webspeech')}
                className="setting-select"
              >
                <option value="whisper">Whisper API (Recommended)</option>
                {webSpeechSupported && <option value="webspeech">Web Speech API (Fallback)</option>}
              </select>
              <small className="setting-help">
                Whisper provides better accuracy and auto-detects language.
              </small>
            </div>

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
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="it">Italiano</option>
                <option value="pt">Português</option>
                <option value="ru">Русский</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="zh">中文</option>
              </select>
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
              <label>Speech Speed: {ttsSettings.speed.toFixed(1)}x</label>
              <input
                type="range"
                min="0.25"
                max="4.0"
                step="0.25"
                value={ttsSettings.speed}
                onChange={(e) => setTtsSettings(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
                className="setting-slider"
                disabled={!ttsSettings.enabled}
              />
              <small className="setting-help">
                Control how fast the speech is delivered (0.25x to 4.0x)
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
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="it">Italiano</option>
                <option value="pt">Português</option>
                <option value="ru">Русский</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="zh">中文</option>
                <option value="ar">العربية</option>
                <option value="hi">हिन्दी</option>
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
            <h1 className="title">Document Assistant</h1>
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
        <div className="chat-layout">
          
          {/* Sidebar - Conversations List */}
          <div className="sidebar">
            <DocumentUploadPanel />
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

          {/* Chat Container */}
          <div className="chat-container">
            
            {/* Chat Header */}
            <div className="chat-header">
              <div>
                <h2 className="chat-title">
                  {currentConversation ? currentConversation.title : 'Document Assistant'}
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
                  <h3>Welcome to Document Assistant</h3>
                  <p>Create a new conversation to start chatting with your documents.</p>
                  {(voiceSupported || webSpeechSupported) && (
                    <p className="voice-hint">
                      <Mic size={16} />
                      Voice input is available! Click the microphone to start.
                    </p>
                  )}
                  {ttsSettings.enabled && (
                    <p className="voice-hint">
                      <Volume2 size={16} />
                      Fast text-to-speech enabled! Assistant responses can be read aloud.
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
                  <p>Ask me anything about your documents. I'll search through them and provide you with accurate answers.</p>
                  
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

              {/* Voice transcript preview */}
              {transcript && (
                <div className="transcript-preview">
                  <span className="transcript-label">Listening:</span>
                  <span className="transcript-text">{transcript}</span>
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

              {/* Show detected language */}
              {detectedLanguage && voiceLanguage === 'auto' && (
                <div className="language-detection">
                  <span className="language-label">Detected:</span>
                  <span className="language-text">{getLanguageName(detectedLanguage)}</span>
                </div>
              )}
              
              <div className="chat-input-wrapper">
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    isRecording ? 
                      (isTranscribing ? "Transcribing audio..." : "Recording... Speak now") : 
                      "Ask anything about your documents..."
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
                  {(voiceSupported || webSpeechSupported) && (
                    <button
                      onClick={toggleRecording}
                      className={`voice-button ${isRecording ? 'listening' : ''}`}
                      title={isRecording ? 'Stop recording' : 'Start voice input'}
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
        </div>
      </div>

      {/* Voice Settings Modal */}
      <VoiceSettingsModal />
    </div>
  );
};

export default DocumentAssistant;