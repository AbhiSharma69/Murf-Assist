"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { GoogleGenAI } from "@google/genai"
import axios from "axios"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Play, Pause, Send, Volume2, Loader2, User, Bot, Mic, MicOff, Square, RotateCcw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface ChatMessage {
  id: string
  text: string
  isUser: boolean
  audioUrl?: string
  timestamp: Date
}

interface GeminiMessage {
  role: "system" | "user" | "model"
  parts: string[]
}

// Extend Window interface for Speech Recognition
declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

export default function AITalkativeAgent() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const recognitionRef = useRef<any>(null)
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatHistory, setChatHistory] = useState<GeminiMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentAudioUrl, setCurrentAudioUrl] = useState("")
  const [isAutoMode, setIsAutoMode] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const { toast } = useToast()

  // Initialize Google GenAI with your API key
  const ai = new GoogleGenAI({ apiKey: "AIzaSyDMaMEBq6Y3P68jSiVHq2Be8x8seI9AT8k" })

  // System prompt and first message
  const systemPrompt =
    "You are a talkative, empathetic assistant bot. Your main job is to help people reduce stress by chatting with them, giving them calming advice, jokes, or friendly motivation. You talk in a relaxed, human tone, like a good friend who really listens. Keep your responses conversational and not too long (2-3 sentences max)."

  const firstMessage = "Hey there 😊 I'm your little stress-buster buddy! What's on your mind today?"

  // Initialize conversation history
  useEffect(() => {
    const initialHistory: GeminiMessage[] = [
      { role: "system", parts: [systemPrompt] },
      { role: "model", parts: [firstMessage] },
    ]
    setChatHistory(initialHistory)

    // Add first message to display
    const firstDisplayMessage: ChatMessage = {
      id: "first-message",
      text: firstMessage,
      isUser: false,
      timestamp: new Date(),
    }
    setMessages([firstDisplayMessage])
  }, [])

  // Clear any pending restart timeouts
  const clearRestartTimeout = () => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
  }

  // Schedule listening restart
  const scheduleListeningRestart = (delay = 1000) => {
    if (!isAutoMode) {
      console.log("Not in auto mode, skipping restart")
      return
    }

    clearRestartTimeout()
    console.log(`Scheduling restart in ${delay}ms`)
    restartTimeoutRef.current = setTimeout(() => {
      console.log("Attempting to restart listening...")
      if (isAutoMode && !isListening && !isGenerating && !isGeneratingAudio && !isPlaying) {
        startListening()
      } else {
        console.log("Cannot restart - busy state:", {
          isAutoMode,
          isListening,
          isGenerating,
          isGeneratingAudio,
          isPlaying,
        })
      }
    }, delay)
  }

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition()
        recognitionRef.current.continuous = false
        recognitionRef.current.interimResults = true
        recognitionRef.current.lang = "en-US"

        recognitionRef.current.onstart = () => {
          console.log("✅ Speech recognition ACTUALLY started")
          setIsListening(true)
        }

        recognitionRef.current.onresult = (event: any) => {
          console.log("Got speech result:", event)
          let finalTranscript = ""
          let interimTranscript = ""

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript
            if (event.results[i].isFinal) {
              finalTranscript += transcript
            } else {
              interimTranscript += transcript
            }
          }

          setTranscript(interimTranscript)

          if (finalTranscript && isAutoMode) {
            console.log("🎤 Final transcript:", finalTranscript)
            setTranscript("")
            handleAutoMessage(finalTranscript.trim())
          }
        }

        recognitionRef.current.onerror = (event: any) => {
          const { error } = event
          console.log("❌ Speech recognition error:", error)

          if (error === "aborted") {
            console.log("Recognition aborted (normal)")
            return
          }

          if (error === "no-speech") {
            console.log("No speech detected, will restart...")
            if (isAutoMode) {
              setTimeout(() => startListening(), 1000)
            }
            return
          }

          if (error === "not-allowed") {
            toast({
              title: "Microphone Access Denied",
              description: "Please allow microphone access to use voice features.",
              variant: "destructive",
            })
            setIsAutoMode(false)
            return
          }

          console.error("Unexpected error:", error)
          setIsListening(false)

          // Try to restart after other errors
          if (isAutoMode) {
            setTimeout(() => startListening(), 2000)
          }
        }

        recognitionRef.current.onend = () => {
          console.log("🔚 Speech recognition ended")
          setIsListening(false)

          // Always restart if in auto mode and not busy
          if (isAutoMode && !isGenerating && !isGeneratingAudio && !isPlaying) {
            console.log("Will restart listening in 1 second...")
            setTimeout(() => startListening(), 1000)
          }
        }
      } else {
        toast({
          title: "Speech Recognition Not Supported",
          description: "Your browser doesn't support speech recognition.",
          variant: "destructive",
        })
      }
    }

    return () => {
      clearRestartTimeout()
    }
  }, [isAutoMode, isGenerating, isGeneratingAudio, isPlaying])

  // Generate AI response using Google GenAI with conversation history
  async function generateAIResponse(userInput: string) {
    try {
      // Add user message to history
      const updatedHistory = [...chatHistory, { role: "user" as const, parts: [userInput] }]

      // Send entire conversation history to maintain context
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash-exp",
        contents: updatedHistory.map((msg) => ({
          role: msg.role === "system" ? "user" : msg.role, // Gemini doesn't support system role directly
          parts: msg.parts.map((part) => ({ text: part })),
        })),
      })

      const aiResponse = response.text

      // Update chat history with both user message and AI response
      const finalHistory = [...updatedHistory, { role: "model" as const, parts: [aiResponse] }]

      setChatHistory(finalHistory)

      return aiResponse
    } catch (error) {
      console.error("Error generating AI response:", error)
      throw error
    }
  }

  // Convert text to speech using Murf API
  async function convertToSpeech(outputText: string) {
    const MurfAPI = "ap2_6eec6eb9-a077-468c-9686-85a469391066"

    const data = {
      text: outputText,
      voiceId: "en-US-terrell",
    }

    try {
      const response = await axios.post("https://api.murf.ai/v1/speech/generate", data, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "api-key": MurfAPI,
        },
      })

      return response.data.audioFile
    } catch (error) {
      console.error("Error converting to speech:", error)
      throw error
    }
  }

  // Handle automated message processing
  async function handleAutoMessage(userInput: string) {
    if (!userInput.trim()) return

    console.log("Processing auto message:", userInput)

    // Stop listening while processing
    stopListening()

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: userInput,
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsGenerating(true)

    try {
      // Generate AI response with conversation history
      const aiResponse = await generateAIResponse(userInput)
      console.log("AI response:", aiResponse)

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: aiResponse,
        isUser: false,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, aiMessage])
      setIsGenerating(false)
      setIsGeneratingAudio(true)

      // Convert to speech
      const audioUrl = await convertToSpeech(aiResponse)
      console.log("Audio URL:", audioUrl)

      setMessages((prev) => prev.map((msg) => (msg.id === aiMessage.id ? { ...msg, audioUrl } : msg)))

      setCurrentAudioUrl(audioUrl)
      setIsGeneratingAudio(false)

      // Auto-play the response
      handlePlayAudio(audioUrl)
    } catch (error) {
      console.error("Error in handleAutoMessage:", error)
      setIsGenerating(false)
      setIsGeneratingAudio(false)
      toast({
        title: "Error",
        description: "Failed to generate response. Please try again.",
        variant: "destructive",
      })
      // Resume listening even after error
      if (isAutoMode) {
        scheduleListeningRestart(2000)
      }
    }
  }

  // Handle manual sending message
  async function handleSendMessage() {
    if (!input.trim()) {
      toast({
        title: "Empty message",
        description: "Please enter a message to send.",
        variant: "destructive",
      })
      return
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: input,
      isUser: true,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    const currentInput = input
    setInput("")
    setIsGenerating(true)

    try {
      // Generate AI response with conversation history
      const aiResponse = await generateAIResponse(currentInput)

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: aiResponse,
        isUser: false,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, aiMessage])
      setIsGenerating(false)
      setIsGeneratingAudio(true)

      // Convert to speech
      const audioUrl = await convertToSpeech(aiResponse)

      setMessages((prev) => prev.map((msg) => (msg.id === aiMessage.id ? { ...msg, audioUrl } : msg)))

      setCurrentAudioUrl(audioUrl)
      setIsGeneratingAudio(false)

      // Auto-play the response
      setTimeout(() => {
        handlePlayAudio(audioUrl)
      }, 500)
    } catch (error) {
      setIsGenerating(false)
      setIsGeneratingAudio(false)
      toast({
        title: "Error",
        description: "Failed to generate response. Please try again.",
      })
    }
  }

  // Reset conversation
  function resetConversation() {
    const initialHistory: GeminiMessage[] = [
      { role: "system", parts: [systemPrompt] },
      { role: "model", parts: [firstMessage] },
    ]
    setChatHistory(initialHistory)

    const firstDisplayMessage: ChatMessage = {
      id: "first-message-" + Date.now(),
      text: firstMessage,
      isUser: false,
      timestamp: new Date(),
    }
    setMessages([firstDisplayMessage])

    toast({
      title: "Conversation Reset",
      description: "Started a fresh conversation with your stress-buster buddy!",
    })
  }

  // Start listening
  function startListening() {
    console.log("startListening called", {
      hasRecognition: !!recognitionRef.current,
      isListening,
      isAutoMode,
    })

    if (!recognitionRef.current) {
      console.log("No recognition ref")
      return
    }

    if (isListening) {
      console.log("Already listening")
      return
    }

    if (!isAutoMode) {
      console.log("Not in auto mode")
      return
    }

    try {
      console.log("Actually starting speech recognition...")
      recognitionRef.current.start()
      console.log("Start command sent")
    } catch (error) {
      console.error("Error starting speech recognition:", error)
      // If it's already running, that's fine
      if (error.name !== "InvalidStateError") {
        // Try again after a delay
        setTimeout(() => {
          if (isAutoMode && !isListening) {
            startListening()
          }
        }, 1000)
      }
    }
  }

  // Stop listening
  function stopListening() {
    clearRestartTimeout()
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop()
      } catch (error) {
        console.error("Error stopping speech recognition:", error)
      }
      setIsListening(false)
      setTranscript("")
    }
  }

  // Toggle auto mode
  function toggleAutoMode() {
    if (isAutoMode) {
      // Turning off auto mode
      setIsAutoMode(false)
      stopListening()
      clearRestartTimeout()
      toast({
        title: "Auto Mode Disabled",
        description: "Switched back to manual mode.",
      })
    } else {
      // Turning on auto mode
      setIsAutoMode(true)
      toast({
        title: "Auto Mode Enabled",
        description: "Speak to start a conversation. The AI will respond automatically.",
      })
      // Force start listening immediately
      setTimeout(() => {
        console.log("Force starting listening...")
        if (recognitionRef.current) {
          try {
            recognitionRef.current.start()
            console.log("Recognition started successfully")
          } catch (error) {
            console.error("Failed to start recognition:", error)
            // Try again after a short delay
            setTimeout(() => {
              try {
                recognitionRef.current.start()
              } catch (e) {
                console.error("Second attempt failed:", e)
              }
            }, 1000)
          }
        }
      }, 200)
    }
  }

  // Handle audio playback
  function handlePlayAudio(audioUrl?: string) {
    if (!audioRef.current) return
    const audio = audioRef.current
    const srcToPlay = audioUrl || currentAudioUrl
    if (!srcToPlay) return

    console.log("Playing audio:", srcToPlay)

    audio.pause()
    audio.currentTime = 0

    if (audio.src !== srcToPlay) {
      audio.src = srcToPlay
      audio.load()
    }

    const playWhenReady = () => {
      audio.removeEventListener("canplaythrough", playWhenReady)
      audio
        .play()
        .then(() => {
          console.log("Audio started playing")
          setIsPlaying(true)
        })
        .catch((e) => {
          console.warn("Audio play interrupted:", e)
        })
    }

    audio.addEventListener("canplaythrough", playWhenReady, { once: true })
  }

  function handlePauseAudio() {
    if (audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (audio) {
      const handleEnded = () => {
        console.log("Audio playback ended")
        setIsPlaying(false)
        if (isAutoMode) {
          scheduleListeningRestart(1500)
        }
      }

      const handlePause = () => setIsPlaying(false)
      const handlePlay = () => setIsPlaying(true)

      audio.addEventListener("ended", handleEnded)
      audio.addEventListener("pause", handlePause)
      audio.addEventListener("play", handlePlay)

      return () => {
        audio.removeEventListener("ended", handleEnded)
        audio.removeEventListener("pause", handlePause)
        audio.removeEventListener("play", handlePlay)
      }
    }
  }, [isAutoMode])

  // Handle Enter key press
  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <Card className="shadow-xl">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg">
            <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
              <Volume2 className="h-6 w-6" />
              Stress-Buster Buddy
              {isAutoMode && <span className="text-sm bg-green-500 px-2 py-1 rounded-full">AUTO</span>}
            </CardTitle>
          </CardHeader>

          <CardContent className="p-6">
            {/* Controls */}
            <div className="mb-4 flex justify-center gap-2">
              <Button
                onClick={toggleAutoMode}
                className={`flex items-center gap-2 ${
                  isAutoMode ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {isAutoMode ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isAutoMode ? "Stop Auto Mode" : "Start Auto Mode"}
              </Button>

              <Button onClick={resetConversation} variant="outline" className="flex items-center gap-2 bg-transparent">
                <RotateCcw className="h-4 w-4" />
                Reset Chat
              </Button>
            </div>

            {/* Listening Status */}
            {isAutoMode && (
              <div className="mb-4 text-center">
                <div
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
                    isListening
                      ? "bg-green-100 text-green-800"
                      : isGenerating
                        ? "bg-blue-100 text-blue-800"
                        : isGeneratingAudio
                          ? "bg-purple-100 text-purple-800"
                          : isPlaying
                            ? "bg-orange-100 text-orange-800"
                            : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {isListening ? (
                    <Mic className="h-4 w-4 animate-pulse" />
                  ) : isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isGeneratingAudio ? (
                    <Volume2 className="h-4 w-4 animate-pulse" />
                  ) : isPlaying ? (
                    <Play className="h-4 w-4" />
                  ) : (
                    <MicOff className="h-4 w-4" />
                  )}
                  <span className="text-sm">
                    {isListening
                      ? "Listening..."
                      : isGenerating
                        ? "Thinking of something helpful..."
                        : isGeneratingAudio
                          ? "Preparing my voice..."
                          : isPlaying
                            ? "Speaking to you..."
                            : "Ready to listen..."}
                    {transcript && ` - "${transcript}"`}
                  </span>
                </div>
              </div>
            )}

            {/* Chat Messages */}
            <div className="h-96 overflow-y-auto mb-6 space-y-4 bg-gray-50 rounded-lg p-4">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`flex items-start gap-2 max-w-xs lg:max-w-md ${message.isUser ? "flex-row-reverse" : "flex-row"}`}
                  >
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        message.isUser ? "bg-blue-600 text-white" : "bg-green-500 text-white"
                      }`}
                    >
                      {message.isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>
                    <div
                      className={`px-4 py-2 rounded-lg ${
                        message.isUser
                          ? "bg-blue-600 text-white rounded-br-none"
                          : "bg-white text-gray-800 shadow-md rounded-bl-none border-l-4 border-green-500"
                      }`}
                    >
                      <p className="text-sm">{message.text}</p>
                      <p className="text-xs opacity-70 mt-1">{message.timestamp.toLocaleTimeString()}</p>
                      {!message.isUser && message.audioUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 p-1 h-auto hover:bg-gray-100"
                          onClick={() => handlePlayAudio(message.audioUrl)}
                        >
                          <Play className="h-3 w-3 mr-1" />
                          <span className="text-xs">Play</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Manual Input Area - Hidden in Auto Mode */}
            {!isAutoMode && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Share what's on your mind... (Press Enter to send)"
                    className="flex-1 min-h-[60px] resize-none"
                    disabled={isGenerating || isGeneratingAudio}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={isGenerating || isGeneratingAudio || !input.trim()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isGenerating || isGeneratingAudio ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {/* Audio Controls */}
                <div className="flex justify-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handlePlayAudio()}
                    disabled={!currentAudioUrl || isPlaying}
                    className="flex items-center gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Play Last Response
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handlePauseAudio}
                    disabled={!isPlaying}
                    className="flex items-center gap-2 bg-transparent"
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                </div>
              </div>
            )}

            {/* Conversation Context Info */}
            <div className="text-center text-xs text-gray-500 mt-4">
              💬 {chatHistory.length - 2} messages in conversation • Your buddy remembers our chat!
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hidden Audio Element */}
      <audio ref={audioRef} className="hidden" />
    </div>
  )
}
