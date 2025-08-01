import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Clock, AlertCircle, FileText, Database, Plus, MessageCircle, Trash2, Mic, MicOff, Settings, Volume2, VolumeX, Play, Pause } from 'lucide-react';
import axios from 'axios';
import './App.css';

const DocumentAssistant = () => {
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState('');
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

  // Text-to-Speech states
  const [ttsSupported, setTtsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechQueue, setSpeechQueue] = useState([]);
  const [currentSpeechId, setCurrentSpeechId] = useState(null);
  const [ttsSettings, setTtsSettings] = useState({
    enabled: true,
    autoSpeak: false,
    voice: null,
    rate: 1.0,
    pitch: 1.0,
    volume: 0.8,
    language: 'auto' // auto-detect from text or use specific language
  });
  const [availableVoices, setAvailableVoices] = useState([]);

  // Voice settings modal
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // Refs for auto-scrolling and TTS
  const messagesEndRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const speechSynthRef = useRef(null);

  // Speech recognition ref for Web Speech API fallback
  const recognitionRef = useRef(null);

  // API base URL
  const API_BASE_URL = 'http://127.0.0.1:8000';
  const USER_ID = 'user123'; // In real app, get from auth

  // Initialize voice capabilities including TTS
  useEffect(() => {
    initializeVoiceCapabilities();
    initializeTextToSpeech();
    
    return () => {
      cleanup();
    };
  }, []);

  const initializeVoiceCapabilities = async () => {
    // Check for MediaRecorder support (preferred method)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
      setVoiceSupported(true);
    }

    // Check for Web Speech API as fallback
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      setWebSpeechSupported(true);
      initializeWebSpeechAPI();
    }
  };

  const initializeTextToSpeech = () => {
    if ('speechSynthesis' in window) {
      setTtsSupported(true);
      speechSynthRef.current = window.speechSynthesis;
      
      // Load available voices
      const loadVoices = () => {
        const voices = speechSynthRef.current.getVoices();
        setAvailableVoices(voices);
        
        // Set default voice (prefer English or user's language)
        if (!ttsSettings.voice && voices.length > 0) {
          const preferredVoice = voices.find(voice => 
            voice.lang.startsWith('en') && voice.default
          ) || voices.find(voice => 
            voice.lang.startsWith('en')
          ) || voices[0];
          
          setTtsSettings(prev => ({
            ...prev,
            voice: preferredVoice
          }));
        }
      };

      // Load voices immediately and on voiceschanged event
      loadVoices();
      speechSynthRef.current.addEventListener('voiceschanged', loadVoices);

      // Handle speech events
      const handleSpeechEnd = () => {
        setIsSpeaking(false);
        setCurrentSpeechId(null);
        processSpeechQueue();
      };

      const handleSpeechError = (error) => {
        console.error('Speech synthesis error:', error);
        setIsSpeaking(false);
        setCurrentSpeechId(null);
        processSpeechQueue();
      };

      // Store event handlers for cleanup
      speechSynthRef.current.addEventListener('end', handleSpeechEnd);
      speechSynthRef.current.addEventListener('error', handleSpeechError);
      
      return () => {
        if (speechSynthRef.current) {
          speechSynthRef.current.removeEventListener('voiceschanged', loadVoices);
          speechSynthRef.current.removeEventListener('end', handleSpeechEnd);
          speechSynthRef.current.removeEventListener('error', handleSpeechError);
        }
      };
    }
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
      // Stop any ongoing speech when starting to record
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

  // Text-to-Speech Functions
  const speakText = (text, messageId = null, options = {}) => {
    if (!ttsSupported || !ttsSettings.enabled || !text.trim()) {
      return;
    }

    // Stop current speech if any
    if (isSpeaking) {
      stopSpeaking();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Apply settings
    utterance.voice = options.voice || ttsSettings.voice;
    utterance.rate = options.rate || ttsSettings.rate;
    utterance.pitch = options.pitch || ttsSettings.pitch;
    utterance.volume = options.volume || ttsSettings.volume;
    
    // Set language based on settings or detection
    if (options.language) {
      utterance.lang = options.language;
    } else if (ttsSettings.language === 'auto') {
      // Try to detect language from text or use voice language
      utterance.lang = detectLanguageFromText(text) || (ttsSettings.voice?.lang) || 'en-US';
    } else {
      utterance.lang = ttsSettings.language;
    }

    // Event handlers
    utterance.onstart = () => {
      setIsSpeaking(true);
      setCurrentSpeechId(messageId);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setCurrentSpeechId(null);
      processSpeechQueue();
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      setIsSpeaking(false);
      setCurrentSpeechId(null);
      processSpeechQueue();
    };

    // Speak immediately
    speechSynthRef.current.speak(utterance);
  };

  const stopSpeaking = () => {
    if (speechSynthRef.current && isSpeaking) {
      speechSynthRef.current.cancel();
      setIsSpeaking(false);
      setCurrentSpeechId(null);
      setSpeechQueue([]);
    }
  };

  const processSpeechQueue = () => {
    if (speechQueue.length > 0 && !isSpeaking) {
      const nextSpeech = speechQueue[0];
      setSpeechQueue(prev => prev.slice(1));
      speakText(nextSpeech.text, nextSpeech.messageId, nextSpeech.options);
    }
  };

  const queueSpeech = (text, messageId = null, options = {}) => {
    setSpeechQueue(prev => [...prev, { text, messageId, options }]);
    if (!isSpeaking) {
      processSpeechQueue();
    }
  };

  const handleSpeakMessage = (message) => {
    if (currentSpeechId === message.id) {
      stopSpeaking();
    } else {
      speakText(message.content, message.id);
    }
  };

  const detectLanguageFromText = (text) => {
    // Simple language detection based on character patterns
    // This is basic - for production, consider using a proper language detection library
    
    // Turkish detection
    if (/[ğüşıöçĞÜŞİÖÇ]/.test(text)) {
      return 'tr-TR';
    }
    
    // German detection
    if (/[äöüßÄÖÜ]/.test(text)) {
      return 'de-DE';
    }
    
    // French detection
    if (/[àâäéèêëïîôùûüÿñç]/.test(text)) {
      return 'fr-FR';
    }
    
    // Spanish detection
    if (/[ñáéíóúü¿¡]/.test(text)) {
      return 'es-ES';
    }
    
    // Default to English
    return 'en-US';
  };

  const testVoice = () => {
    const testText = "Hello! This is a test of the text-to-speech functionality. How does it sound?";
    speakText(testText, 'test', ttsSettings);
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
        // Mark as spoken to avoid re-speaking
        setMessages(prev => prev.map(msg => 
          msg.id === lastMessage.id 
            ? { ...msg, hasBeenSpoken: true }
            : msg
        ));
        
        // Speak the message
        setTimeout(() => {
          speakText(lastMessage.content, lastMessage.id);
        }, 500); // Small delay to ensure UI is updated
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
    if (speechSynthRef.current && isSpeaking) {
      speechSynthRef.current.cancel();
    }
  };

  // MediaRecorder-based voice recording (preferred method)
  const startRecording = async () => {
    try {
      // Stop any ongoing speech
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
        
        // Cleanup
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

  // Transcribe audio using backend Whisper API
  const transcribeAudio = async (audioBlob) => {
    setIsTranscribing(true);
    
    try {
      const formData = new FormData();
      formData.append('audio_file', audioBlob, 'recording.webm');
      
      // Only send language if not auto-detect
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
        // Store detected language info
        if (auto_detected && language) {
          setDetectedLanguage(language);
        }
        
        // Check for voice commands first
        if (!processVoiceCommand(text.trim())) {
          setQuery(prev => prev + text);
          if (confidence) {
            setConfidence(confidence);
          }
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

  // Web Speech API fallback methods
  const startWebSpeechRecording = () => {
    if (recognitionRef.current && webSpeechSupported) {
      try {
        stopSpeaking(); // Stop any ongoing speech
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

  // Main voice recording toggle
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

  // Voice Commands (enhanced with TTS commands)
  const processVoiceCommand = (command) => {
    const lowerCommand = command.toLowerCase().trim();
    
    if (lowerCommand.includes('new chat') || lowerCommand.includes('start new conversation')) {
      createNewConversation();
      return true;
    }
    
    if (lowerCommand.includes('delete conversation') || lowerCommand.includes('delete chat')) {
      if (currentConversation) {
        deleteConversation(currentConversation.conversation_id);
      }
      return true;
    }
    
    if (lowerCommand.includes('clear input') || lowerCommand.includes('clear text')) {
      setQuery('');
      return true;
    }
    
    if (lowerCommand.includes('stop speaking') || lowerCommand.includes('stop reading')) {
      stopSpeaking();
      return true;
    }
    
    if (lowerCommand.includes('read last message') || lowerCommand.includes('repeat')) {
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.type === 'assistant') {
          speakText(lastMessage.content, lastMessage.id);
        }
      }
      return true;
    }
    
    return false;
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
      
      const frontendMessages = backendMessages.map(msg => ({
        id: msg._id || msg.message_id,
        type: msg.role,
        content: msg.content,
        sources: msg.sources ? msg.sources.map((chunk, index) => ({
          name: `Source ${index + 1}`,
          snippet: chunk.length > 150 ? chunk.substring(0, 150) + "..." : chunk
        })) : [],
        timestamp: new Date(msg.timestamp),
        voiceMetadata: msg.voice_metadata,
        hasBeenSpoken: true // Mark existing messages as spoken to avoid auto-speaking on load
      }));
      
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
    
    // Check for voice commands first
    if (processVoiceCommand(currentQuery)) {
      setQuery('');
      return;
    }

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
    
    // Reset confidence after using it
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
        hasBeenSpoken: false // Mark as not spoken for auto-speak functionality
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
    stopSpeaking(); // Stop any ongoing speech when switching conversations
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSearching) {
      e.preventDefault();
      handleSearch();
    }
  };

  // Helper function to get language display name
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

  // Enhanced Voice Settings Modal Component
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
                Whisper provides better accuracy and auto-detects language. Web Speech works offline in supported browsers.
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
          {ttsSupported && (
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
                  value={ttsSettings.voice?.name || ''} 
                  onChange={(e) => {
                    const selectedVoice = availableVoices.find(voice => voice.name === e.target.value);
                    setTtsSettings(prev => ({ ...prev, voice: selectedVoice }));
                  }}
                  className="setting-select"
                  disabled={!ttsSettings.enabled}
                >
                  {availableVoices.map((voice, index) => (
                    <option key={index} value={voice.name}>
                      {voice.name} ({voice.lang}) {voice.default ? '(Default)' : ''}
                    </option>
                  ))}
                </select>
                <small className="setting-help">
                  Choose the voice for text-to-speech output
                </small>
              </div>

              <div className="setting-group">
                <label>Speech Rate: {ttsSettings.rate.toFixed(1)}x</label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={ttsSettings.rate}
                  onChange={(e) => setTtsSettings(prev => ({ ...prev, rate: parseFloat(e.target.value) }))}
                  className="setting-slider"
                  disabled={!ttsSettings.enabled}
                />
                <small className="setting-help">
                  Control how fast the speech is delivered
                </small>
              </div>

              <div className="setting-group">
                <label>Speech Pitch: {ttsSettings.pitch.toFixed(1)}</label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={ttsSettings.pitch}
                  onChange={(e) => setTtsSettings(prev => ({ ...prev, pitch: parseFloat(e.target.value) }))}
                  className="setting-slider"
                  disabled={!ttsSettings.enabled}
                />
                <small className="setting-help">
                  Adjust the pitch of the voice
                </small>
              </div>

              <div className="setting-group">
                <label>Volume: {Math.round(ttsSettings.volume * 100)}%</label>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={ttsSettings.volume}
                  onChange={(e) => setTtsSettings(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                  className="setting-slider"
                  disabled={!ttsSettings.enabled}
                />
                <small className="setting-help">
                  Control the volume of speech output
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
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="tr-TR">Türkçe</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="fr-FR">Français</option>
                  <option value="es-ES">Español</option>
                  <option value="it-IT">Italiano</option>
                  <option value="pt-PT">Português</option>
                  <option value="ru-RU">Русский</option>
                  <option value="ja-JP">日本語</option>
                  <option value="ko-KR">한국어</option>
                  <option value="zh-CN">中文</option>
                </select>
                <small className="setting-help">
                  Choose language for speech synthesis or let it auto-detect
                </small>
              </div>
            </div>
          )}

          {/* Voice Commands Section */}
          <div className="setting-section">
            <h4>Voice Commands</h4>
            <div className="voice-commands-help">
              <p><strong>Speech Recognition Commands:</strong></p>
              <ul>
                <li>"New chat" - Start a new conversation</li>
                <li>"Delete conversation" - Delete current chat</li>
                <li>"Clear input" - Clear the input field</li>
                <li>"Stop speaking" - Stop current speech output</li>
                <li>"Read last message" - Repeat the last assistant message</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="voice-settings-footer">
          {ttsSupported && (
            <button 
              onClick={testVoice} 
              className="test-voice-button"
              disabled={!ttsSettings.enabled}
            >
              {isSpeaking ? <VolumeX size={16} /> : <Volume2 size={16} />}
              {isSpeaking ? 'Stop Test' : 'Test Voice'}
            </button>
          )}
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
              {ttsSupported && isSpeaking && (
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
                  {isSpeaking && (
                    <span className="speaking-indicator">
                      <Volume2 size={16} />
                      Speaking...
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
                  {ttsSupported && (
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
                  <p>Ask me anything about your documents. I'll search through them and provide you with accurate answers.</p>
                  
                  {/* Voice Commands Help */}
                  {(voiceSupported || webSpeechSupported || ttsSupported) && (
                    <div className="voice-commands-help">
                      <h4>Voice Features Available:</h4>
                      <ul>
                        {(voiceSupported || webSpeechSupported) && (
                          <>
                            <li>🎤 Voice input - Click microphone to speak</li>
                            <li>"New chat" - Start a new conversation</li>
                            <li>"Clear input" - Clear the input field</li>
                          </>
                        )}
                        {ttsSupported && (
                          <>
                            <li>🔊 Text-to-speech - Messages can be read aloud</li>
                            <li>"Stop speaking" - Stop current speech</li>
                            <li>"Read last message" - Repeat last response</li>
                          </>
                        )}
                      </ul>
                    </div>
                  )}
                  
                  {/* Quick suggestions */}
                  <div className="suggestions">
                    <p>Try asking:</p>
                    {['What are the company policies?', 'Show me sales trends', 'Recent updates', 'Key metrics'].map((suggestion, index) => (
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
                          {message.type === 'assistant' && ttsSupported && ttsSettings.enabled && (
                            <button
                              onClick={() => handleSpeakMessage(message)}
                              className="speak-message-button"
                              title={currentSpeechId === message.id ? 'Stop speaking' : 'Read message aloud'}
                            >
                              {currentSpeechId === message.id ? (
                                <VolumeX size={14} />
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
                            <Volume2 size={12} />
                            <span>Speaking...</span>
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
                  {ttsSupported && isSpeaking && !isRecording && (
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