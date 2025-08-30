"use client"
import { useState, useEffect, useRef } from "react"
import {
  View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  AppState,
  Dimensions,
  BackHandler,
  Animated,
  Easing,
  PanResponder,
} from "react-native"
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from "react-native-maps"
import * as Location from "expo-location"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import CustomModal from "../components/CustomModal"
import { FontAwesome } from "@expo/vector-icons"
import Icon from "react-native-vector-icons/FontAwesome"
import { Ionicons } from "@expo/vector-icons"
import { calculateDistance, formatTime, calculatePace, formatPace } from "../utils/activityUtils"
import { db, auth } from "../firebaseConfig"
import { collection, addDoc, serverTimestamp, doc, getDoc, updateDoc } from "firebase/firestore"
import { generateRoute } from "../utils/routeGenerator"
import { LinearGradient } from "expo-linear-gradient"

const { width, height } = Dimensions.get("window")
const isAndroid = Platform.OS === "android"
const isSmallDevice = width < 375

const MINIMUM_DISTANCE_THRESHOLDS = {
  walking: 1.5,
  jogging: 2.0,
  running: 2.5,
  cycling: 3.0,
}

const PACE_WINDOW_SIZES = {
  walking: 5,
  jogging: 5,
  running: 5,
  cycling: 7,
}

const MapScreen = ({ navigateToActivity, navigateToDashboard, params = {} }) => {
  console.log("MapScreen: Initialized with params:", params)
  const {
    activityType = "walking",
    activityColor = "#4361EE",
    targetDistance = "0",
    targetTime = "0",
    tracking: initialTracking = false,
    initialCoordinates = [],
    initialStats = { distance: 0, duration: 0, pace: 0, avgSpeed: 0 },
    activeQuest = null,
    userHeight = 170,
  } = params

  // Core state variables
  const [coordinates, setCoordinates] = useState(initialCoordinates)
  const [currentLocation, setCurrentLocation] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tracking, setTracking] = useState(initialTracking)
  const [isTrackingLoading, setIsTrackingLoading] = useState(false)
  const [stats, setStats] = useState(initialStats)
  const [watchId, setWatchId] = useState(null)
  const [gpsSignal, setGpsSignal] = useState("Unknown")
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false)
  const [distanceThreshold, setDistanceThreshold] = useState(MINIMUM_DISTANCE_THRESHOLDS[activityType] || 1.5)
  const [smoothedPace, setSmoothedPace] = useState(0)
  const [gpsIndicatorPosition, setGpsIndicatorPosition] = useState({
    x: width - 100,
    y: 16,
  })
  const [suggestedRoute, setSuggestedRoute] = useState(null)
  const [showSuggestedRoute, setShowSuggestedRoute] = useState(false)
  const [isGeneratingRoute, setIsGeneratingRoute] = useState(false)
  const [followingSuggestedRoute, setFollowingSuggestedRoute] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  // Updated modalContent to include type, icon, and buttons
  const [modalContent, setModalContent] = useState({
    title: "",
    message: "",
    onConfirm: null,
    type: "info",
    icon: null,
    buttons: [],
  })
  // New state for pause functionality
  const [isPaused, setIsPaused] = useState(false)

  // Simplified quest and user state (quest comes from Dashboard)
  const [selectedQuest, setSelectedQuest] = useState(null)
  const [userStats, setUserStats] = useState({
    // Corrected to useState
    level: 1,
    totalXP: 0,
  })
  console.log("MapScreen: Current selectedQuest state:", selectedQuest)

  const pan = useRef(new Animated.ValueXY({ x: width - 100, y: 16 })).current
  const recentPacesRef = useRef([])
  const paceWindowSizeRef = useRef(PACE_WINDOW_SIZES[activityType] || 5)

  // Animation refs
  const buttonScaleAnim = useRef(new Animated.Value(1)).current // Main button scale
  const saveButtonScaleAnim = useRef(new Animated.Value(1)).current // Save button scale
  const discardButtonScaleAnim = useRef(new Animated.Value(1)).current // Discard button scale
  const iconPulseAnim = useRef(new Animated.Value(1)).current
  const iconMoveAnim = useRef(new Animated.Value(0)).current
  const spinAnim = useRef(new Animated.Value(0)).current // Changed initial value to 0 for spin
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(50)).current
  const statsSlideAnim = useRef(new Animated.Value(100)).current
  const headerSlideAnim = useRef(new Animated.Value(-50)).current
  const questPulseAnim = useRef(new Animated.Value(1)).current
  // New animation values for Save/Discard buttons
  const saveDiscardFadeAnim = useRef(new Animated.Value(0)).current
  const saveDiscardSlideAnim = useRef(new Animated.Value(50)).current

  // Refs
  const mapRef = useRef(null)
  const intervalRef = useRef(null)
  const startTimeRef = useRef(null)
  const lastUpdateTimeRef = useRef(Date.now())
  const lowAccuracyCountRef = useRef(0)
  const rawCoordinatesRef = useRef([])
  const locationWatchRef = useRef(null)
  const lastCoordinateRef = useRef(null)

  const locationAccuracy =
    activityType === "running" || activityType === "jogging"
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.High
  const locationDistanceInterval = 5
  const locationTimeInterval = activityType === "cycling" ? 1000 : 500

  const activityConfigs = {
    walking: { icon: "walk", color: "#4361EE", strokeColor: "#4361EE", darkColor: "#3651D4" },
    running: { icon: "running", color: "#EF476F", strokeColor: "#EF476F", darkColor: "#D43E63" },
    cycling: { icon: "bicycle", color: "#06D6A0", strokeColor: "#06D6A0", darkColor: "#05C090" },
    jogging: { icon: "running", color: "#FFD166", strokeColor: "#FFD166", darkColor: "#E6BC5C" },
  }
  const currentActivity = activityConfigs[activityType] || activityConfigs.walking
  const maxSpeed = activityType === "cycling" ? 20 : 8

  // Create pan responder for draggable GPS indicator
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: pan.x._value,
          y: pan.y._value,
        })
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset()
        setGpsIndicatorPosition({
          x: pan.x._value,
          y: pan.y._value,
        })
      },
    }),
  ).current

  // Load user stats from Firestore (simplified version)
  const loadUserStats = async () => {
    try {
      const user = auth.currentUser
      if (!user) {
        console.log("MapScreen: No user found for loading stats")
        return
      }
      console.log("MapScreen: Loading user stats for user:", user.uid)
      const userRef = doc(db, "users", user.uid)
      const userDoc = await getDoc(userRef)
      if (userDoc.exists()) {
        const userData = userDoc.data()
        console.log("MapScreen: Loaded user data:", userData)
        setUserStats({
          level: userData.level || 1,
          totalXP: userData.totalXP || 0,
        })
      } else {
        console.log("MapScreen: User document does not exist, using defaults")
      }
    } catch (error) {
      console.error("MapScreen: Error loading user stats:", error)
    }
  }

  // Enhanced quest initialization from params (same as ActivityScreen)
  useEffect(() => {
    console.log("MapScreen: Processing params for quest initialization:", params)
    if (params.questId || (params.title && params.description && params.goal && params.unit)) {
      const questData = {
        id: params.questId || `quest_${Date.now()}`,
        title: params.title,
        description: params.description,
        goal: params.goal,
        unit: params.unit,
        progress: params.progress || 0, // Use progress from Dashboard
        status: params.status || "not_started",
        activityType: params.activityType,
        xpReward: params.xpReward || 50,
        difficulty: params.difficulty || "medium",
        category: params.category || "fitness",
      }
      console.log("MapScreen: Setting selected quest from params:", questData)
      setSelectedQuest(questData)
    } else if (activeQuest) {
      console.log("MapScreen: Setting selected quest from activeQuest param:", activeQuest)
      setSelectedQuest(activeQuest)
    } else {
      console.log("MapScreen: No quest data found in params")
      setSelectedQuest(null)
    }
  }, [params, activeQuest])

  // Load user stats on component mount
  useEffect(() => {
    loadUserStats()
  }, [])

  // Start quest pulse animation when quest is selected
  useEffect(() => {
    if (selectedQuest) {
      console.log("MapScreen: Starting pulse animation for selected quest")
      Animated.loop(
        Animated.sequence([
          Animated.timing(questPulseAnim, {
            toValue: 1.05,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(questPulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      ).start()
    }
  }, [selectedQuest, questPulseAnim])

  // Updated quest progress calculation to use Dashboard data when available (same as ActivityScreen)
  const getDisplayQuestProgress = (quest) => {
    if (!quest) {
      console.log("MapScreen: No quest provided for progress calculation")
      return 0
    }
    // If we have progress from Dashboard and no current activity, use Dashboard progress
    if (quest.progress !== undefined && stats.distance === 0) {
      console.log("MapScreen: Using Dashboard progress:", quest.progress)
      return quest.progress
    }
    // Otherwise calculate current progress based on activity stats
    let currentValue = 0
    if (quest.unit === "reps") {
      currentValue = stats.reps || 0
    } else if (quest.unit === "distance" || quest.unit === "km") {
      currentValue = stats.distance / 1000
    } else if (quest.unit === "duration" || quest.unit === "minutes") {
      currentValue = stats.duration / 60 // Convert to minutes
    } else if (quest.unit === "pace") {
      currentValue = stats.pace
    } else if (quest.unit === "calories") {
      currentValue = stats.calories || 0
    }

    const goalValue = Number.parseFloat(quest.goal || 0)

    // For pace quests, progress is achieved when current pace is better (lower) than goal
    if (quest.unit === "pace") {
      const calculatedProgress =
        currentValue > 0 && currentValue <= goalValue ? 1 : Math.max(0, 1 - (currentValue - goalValue) / goalValue)
      console.log("MapScreen: Calculated pace quest progress:", {
        unit: quest.unit,
        currentValue,
        goalValue,
        calculatedProgress,
        dashboardProgress: quest.progress,
        usingDashboardProgress: quest.progress !== undefined && stats.distance === 0,
      })
      return calculatedProgress
    }

    const calculatedProgress = Math.min(currentValue / goalValue, 1)
    console.log("MapScreen: Calculated quest progress:", {
      unit: quest.unit,
      currentValue,
      goalValue,
      calculatedProgress,
      dashboardProgress: quest.progress,
      usingDashboardProgress: quest.progress !== undefined && stats.distance === 0,
    })
    return calculatedProgress
  }

  const getQuestStatus = (quest) => {
    const progress = getDisplayQuestProgress(quest)
    if (progress >= 1) return "completed"
    if (progress > 0) return "in_progress"
    return "not_started"
  }

  // Get current quest value for display (same as ActivityScreen)
  const getCurrentQuestValue = (quest) => {
    if (!quest) return 0
    // If we have progress from Dashboard and no current activity, calculate from Dashboard progress
    if (quest.progress !== undefined && stats.distance === 0) {
      const dashboardValue = Math.floor(quest.progress * quest.goal)
      console.log("MapScreen: Using Dashboard value:", dashboardValue, "from progress:", quest.progress)
      return dashboardValue
    }
    // Otherwise use current activity stats
    if (quest.unit === "reps") {
      return Math.min(stats.reps || 0, quest.goal)
    } else if (quest.unit === "distance" || quest.unit === "km") {
      return Math.min(stats.distance / 1000, quest.goal)
    } else if (quest.unit === "duration" || quest.unit === "minutes") {
      return Math.min(Math.floor(stats.duration / 60), quest.goal)
    } else if (quest.unit === "pace") {
      return stats.pace
    } else if (quest.unit === "calories") {
      return Math.min(stats.calories || 0, quest.goal)
    }
    return 0
  }

  // Function to calculate the moving average for pace
  const calculateMovingAveragePace = (newPace) => {
    if (isNaN(newPace) || newPace === 0 || !isFinite(newPace)) {
      if (recentPacesRef.current.length === 0) {
        return 0
      }
      const sum = recentPacesRef.current.reduce((acc, val) => acc + val, 0)
      return sum / recentPacesRef.current.length
    }
    recentPacesRef.current.push(newPace)
    if (recentPacesRef.current.length > paceWindowSizeRef.current) {
      recentPacesRef.current.shift()
    }
    const sum = recentPacesRef.current.reduce((acc, val) => acc + val, 0)
    return sum / recentPacesRef.current.length
  }

  // Set initial position for the pan animation
  useEffect(() => {
    pan.setValue({ x: gpsIndicatorPosition.x, y: gpsIndicatorPosition.y })
  }, [])

  // Initialize activity thresholds based on type
  useEffect(() => {
    setDistanceThreshold(MINIMUM_DISTANCE_THRESHOLDS[activityType] || 1.5)
    paceWindowSizeRef.current = PACE_WINDOW_SIZES[activityType] || 5
    recentPacesRef.current = []
    setSmoothedPace(0)
  }, [activityType])

  // Function to generate a suggested route
  const handleGenerateRoute = async () => {
    if (!currentLocation) {
      showModal("Error", "Cannot generate route. Current location not available.", null, "error", "map-marker-alt")
      return
    }
    setIsGeneratingRoute(true)
    try {
      const route = await generateRoute(
        { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
        Number.parseFloat(targetDistance),
        activityType,
      )
      if (route) {
        setSuggestedRoute(route)
        setShowSuggestedRoute(true)
        if (mapRef.current && route.coordinates.length > 0) {
          mapRef.current.fitToCoordinates(route.coordinates, {
            edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
            animated: true,
          })
        }
        showModal(
          "Route Generated",
          `A ${route.difficulty} ${route.distance} km ${route.routeType || ""} route has been created for ${activityType}. Would you like to follow this route?`,
          () => {
            setFollowingSuggestedRoute(true)
          },
          "info",
          "map-signs",
        )
      } else {
        showModal("Error", "Failed to generate route. Please try again.", null, "error", "exclamation-circle")
      }
    } catch (error) {
      console.error("Route generation error:", error)
      showModal("Error", "Failed to generate route. Please try again.", null, "error", "exclamation-circle")
    } finally {
      setIsGeneratingRoute(false)
    }
  }

  // Function to clear the suggested route
  const clearSuggestedRoute = () => {
    setSuggestedRoute(null)
    setShowSuggestedRoute(false)
    setFollowingSuggestedRoute(false)
    if (mapRef.current && currentLocation) {
      mapRef.current.animateToRegion(
        {
          ...currentLocation,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        1000,
      )
    }
  }

  // Generic button press in/out animations
  const handleButtonPressIn = (scaleAnim) => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start()
  }

  const handleButtonPressOut = (scaleAnim) => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5, // Add some friction for a springy effect
      useNativeDriver: true,
    }).start()
  }

  const startIconPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulseAnim, {
          toValue: 1.2,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconPulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start()
  }

  const startIconMoveAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconMoveAnim, {
          toValue: 5,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconMoveAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start()
  }

  const startSpinAnimation = () => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start()
  }

  const animateScreenElements = () => {
    fadeAnim.setValue(0)
    slideAnim.setValue(50)
    statsSlideAnim.setValue(100)
    headerSlideAnim.setValue(-50)
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(statsSlideAnim, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(headerSlideAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }

  const animateTrackingTransition = (isStarting) => {
    Animated.timing(statsSlideAnim, {
      toValue: isStarting ? 0 : 100,
      duration: 300,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!isStarting) {
        Animated.timing(statsSlideAnim, {
          toValue: 0,
          duration: 300,
          delay: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start()
      }
    })
  }

  const animateSaveDiscardIn = () => {
    saveDiscardFadeAnim.setValue(0)
    saveDiscardSlideAnim.setValue(50)
    Animated.parallel([
      Animated.timing(saveDiscardFadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(saveDiscardSlideAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }

  const animateSaveDiscardOut = () => {
    Animated.parallel([
      Animated.timing(saveDiscardFadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(saveDiscardSlideAnim, {
        toValue: 50,
        duration: 300,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }

  const stopAnimations = () => {
    iconPulseAnim.stopAnimation()
    iconMoveAnim.stopAnimation()
    spinAnim.stopAnimation()
    questPulseAnim.stopAnimation()
    iconPulseAnim.setValue(1)
    iconMoveAnim.setValue(0)
    spinAnim.setValue(0)
    questPulseAnim.setValue(1)
  }

  useEffect(() => {
    if (tracking) {
      startIconPulseAnimation()
      animateTrackingTransition(true)
    } else if (!isTrackingLoading) {
      startIconMoveAnimation()
      if (coordinates.length > 0) {
        animateTrackingTransition(false)
      }
    }
    if (isTrackingLoading) {
      startSpinAnimation()
    }
    return () => {
      stopAnimations()
    }
  }, [tracking, isTrackingLoading])

  useEffect(() => {
    if (!loading) {
      animateScreenElements()
    }
  }, [loading])

  // Effect to manage Save/Discard button visibility
  useEffect(() => {
    const activityEnded = !tracking && !isPaused && coordinates.length > 0
    if (activityEnded) {
      animateSaveDiscardIn()
    } else {
      animateSaveDiscardOut()
    }
  }, [tracking, isPaused, coordinates.length])

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  })

  const returnToActivity = () => {
    navigateToActivity({
      activityType,
      coordinates,
      stats,
      isViewingPastActivity: false,
      // Pass quest data back to ActivityScreen
      ...(selectedQuest && {
        questId: selectedQuest.id,
        title: selectedQuest.title,
        description: selectedQuest.description,
        goal: selectedQuest.goal,
        unit: selectedQuest.unit,
        progress: selectedQuest.progress,
        status: selectedQuest.status,
        xpReward: selectedQuest.xpReward,
        difficulty: selectedQuest.difficulty,
        category: selectedQuest.category,
      }),
    })
  }

  const centerMap = () => {
    if (mapRef.current && currentLocation) {
      mapRef.current.animateToRegion(
        {
          ...currentLocation,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        1000,
      )
    }
  }

  // Updated showModal to accept type, icon, and a 'buttons' array for custom actions
  const showModal = (title, message, onConfirm = null, type = "info", icon = null, buttons = []) => {
    setModalContent({ title, message, onConfirm, type, icon, buttons })
    setModalVisible(true)
  }

  const calculateMetrics = (distance, duration) => {
    const numDistance = Number(distance)
    const numDuration = Number(duration)
    if (numDistance < 5 || numDuration < 5 || isNaN(numDistance) || isNaN(numDuration)) {
      return { pace: 0, avgSpeed: 0 }
    }
    const rawPace = calculatePace(numDistance, numDuration)
    const smoothedPaceValue = calculateMovingAveragePace(rawPace)
    setSmoothedPace(smoothedPaceValue)
    const avgSpeed = numDistance / 1000 / (numDuration / 3600)
    return { pace: smoothedPaceValue, rawPace, avgSpeed }
  }

  // Updated backAction to use the new modal button structure
  const backAction = () => {
    if (tracking || isPaused) {
      showModal(
        "Exit Activity",
        "What would you like to do with your current activity?",
        null, // No default onConfirm, as we're using custom buttons
        "info", // Type for info icon
        "question-circle", // Specific icon
        [
          {
            label: "Save",
            action: () => {
              saveActivity()
              return true // This action will close the modal
            },
            style: "primary",
          },
          {
            label: "Discard",
            action: () => {
              // Call handleDiscard, which will show its own confirmation modal
              handleDiscard()
              return false // IMPORTANT: Return false to prevent this modal from closing immediately
            },
            style: "danger",
          },
          {
            label: "Continue",
            action: () => {
              // Just close the modal, activity state remains as is (tracking or paused)
              return true // This action will close the modal
            },
            style: "secondary",
          },
        ],
      )
      return true
    }
    return false
  }

  useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction)
    return () => backHandler.remove()
  }, [tracking, isPaused, coordinates.length]) // Added coordinates.length to dependency array

  // Initialize location tracking
  useEffect(() => {
    const initialize = async () => {
      try {
        const hasPermission = await requestPermissions()
        if (!hasPermission) {
          setError("Location permissions are required to use this feature.")
          setLoading(false)
          return
        }
        await startLocationUpdates()
        if (initialTracking) {
          await startTracking()
        } else {
          showModal(
            "Optimize GPS Accuracy",
            "For best results, keep your phone in an open position (e.g., armband, bike mount) and avoid pockets or bags.",
            null, // No confirm action
            "info", // Type for info icon
            "location-arrow", // Specific icon
          )
        }
      } catch (err) {
        console.error("Initialization error:", err)
        setError("Failed to initialize. Please check your location settings.")
        setLoading(false)
      }
    }
    initialize()

    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === "background" && tracking) {
        if (isAndroid) {
          showModal(
            "Background Tracking",
            "Tracking may be less accurate in the background.",
            null,
            "info",
            "exclamation-triangle",
          )
        }
      } else if (nextAppState === "active") {
        if (!tracking && locationPermissionGranted && !locationWatchRef.current) {
          startLocationUpdates()
        }
      }
    }

    const subscription = AppState.addEventListener("change", handleAppStateChange)

    return () => {
      subscription?.remove()
      if (locationWatchRef.current) locationWatchRef.current.remove()
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startLocationUpdates = async () => {
    try {
      if (locationWatchRef.current) {
        locationWatchRef.current.remove()
        locationWatchRef.current = null
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: locationAccuracy,
        timeout: 10000,
      })

      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }
      setCurrentLocation(newRegion)
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000)
      }

      const watchId = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (location) => {
          const { latitude, longitude, accuracy, speed } = location.coords
          if (accuracy > 50) {
            setGpsSignal("Poor")
          } else if (accuracy > 30) {
            setGpsSignal("Fair")
          } else if (accuracy > 15) {
            setGpsSignal("Good")
          } else {
            setGpsSignal("Excellent")
          }
          const newRegion = {
            latitude,
            longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }
          setCurrentLocation(newRegion)
        },
      )
      locationWatchRef.current = watchId
      setLoading(false)
    } catch (err) {
      console.error("Location updates error:", err)
      setError("Failed to get location updates. Please check your GPS settings.")
      setLoading(false)
    }
  }

  const requestPermissions = async () => {
    try {
      const enabled = await Location.hasServicesEnabledAsync()
      if (!enabled) {
        showModal(
          "Location Services Disabled",
          "Please enable location services to use this feature",
          () => Location.enableNetworkProviderAsync(),
          "error",
          "exclamation-circle",
        )
        return false
      }

      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") {
        showModal(
          "Permission Denied",
          "This app requires location access to track your activity.",
          null,
          "error",
          "ban",
        )
        return false
      }
      setLocationPermissionGranted(true)

      if (isAndroid) {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync()
        if (backgroundStatus !== "granted") {
          showModal(
            "Background Permission",
            "For continuous tracking, please enable background location in app settings.",
            null,
            "info",
            "info-circle",
          )
        }
      }
      return true
    } catch (err) {
      console.error("Permission error:", err)
      showModal("Error", "Failed to request permissions.", null, "error", "exclamation-circle")
      return false
    }
  }

  const getCurrentLocation = async () => {
    try {
      const hasPermission = await requestPermissions()
      if (!hasPermission) return

      const location = await Location.getCurrentPositionAsync({
        accuracy: locationAccuracy,
        timeout: 10000,
      })

      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }
      setCurrentLocation(newRegion)
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000)
      }
      return location
    } catch (err) {
      console.error(err)
      setError("Failed to get location. Ensure GPS is enabled.")
      throw err
    }
  }

  const startTracking = async () => {
    console.log("MapScreen: Starting tracking")
    setIsTrackingLoading(true)
    setIsPaused(false) // Ensure not paused when starting/resuming

    try {
      const hasPermission = await requestPermissions()
      if (!hasPermission) {
        setError("Location permissions not granted.")
        setIsTrackingLoading(false)
        return
      }

      if (locationWatchRef.current) {
        locationWatchRef.current.remove()
        locationWatchRef.current = null
      }

      let initialLocation
      if (currentLocation) {
        initialLocation = {
          coords: {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            accuracy: 10,
          },
          timestamp: Date.now(),
        }
      } else {
        initialLocation = await getCurrentLocation()
        if (!initialLocation) {
          setError("Failed to get initial location.")
          setIsTrackingLoading(false)
          return
        }
      }

      const initialCoord = {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude,
        timestamp: initialLocation.timestamp,
        accuracy: initialLocation.coords.accuracy,
      }

      // Only reset coordinates and stats if starting a brand new activity
      if (coordinates.length === 0 || !isPaused) {
        // If not resuming, or if it's a fresh start
        lastCoordinateRef.current = initialCoord
        setCoordinates([initialCoord])
        startTimeRef.current = new Date()
        lastUpdateTimeRef.current = Date.now()
        lowAccuracyCountRef.current = 0
        rawCoordinatesRef.current = []
        recentPacesRef.current = []
        setSmoothedPace(0)
        setStats({
          distance: 0,
          duration: 0,
          pace: 0,
          rawPace: 0,
          avgSpeed: 0,
        })
        console.log("MapScreen: Starting new tracking session with reset stats")
      } else {
        // If resuming, ensure lastCoordinateRef is set to the last recorded coordinate
        lastCoordinateRef.current = coordinates[coordinates.length - 1] || initialCoord
        startTimeRef.current = new Date(Date.now() - stats.duration * 1000) // Adjust start time for duration
        console.log("MapScreen: Resuming tracking session")
      }

      setTracking(true)
      setFollowingSuggestedRoute(followingSuggestedRoute)

      console.log("MapScreen: Initial coordinate set:", initialCoord)
      console.log(`MapScreen: Pace window size: ${paceWindowSizeRef.current} for ${activityType}`)

      intervalRef.current = setInterval(() => {
        setStats((prev) => {
          const duration = Math.floor((new Date() - startTimeRef.current) / 1000)
          const metrics = calculateMetrics(prev.distance, duration)
          return { ...prev, duration, ...metrics }
        })
      }, 1000)

      const id = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (location) => {
          const { latitude, longitude, accuracy, speed, altitude } = location.coords
          console.log(
            `MapScreen: Location update: lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}, acc=${accuracy.toFixed(1)}m`,
          )

          if (accuracy > 50 || speed > maxSpeed) {
            lowAccuracyCountRef.current += 1
            if (lowAccuracyCountRef.current >= 5) {
              setGpsSignal("Poor")
            }
            return
          }

          lowAccuracyCountRef.current = 0
          if (accuracy > 30) {
            setGpsSignal("Fair")
          } else if (accuracy > 15) {
            setGpsSignal("Good")
          } else {
            setGpsSignal("Excellent")
          }

          const newCoordinate = {
            latitude,
            longitude,
            accuracy,
            timestamp: location.timestamp,
            altitude,
          }

          rawCoordinatesRef.current.push(newCoordinate)
          if (rawCoordinatesRef.current.length > 5) rawCoordinatesRef.current.shift()

          const smoothedCoordinate = smoothCoordinate(rawCoordinatesRef.current, newCoordinate)

          // Update currentLocation for other uses (e.g., centerMap button)
          setCurrentLocation({
            latitude: smoothedCoordinate.latitude,
            longitude: smoothedCoordinate.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          })

          // Manually animate the map camera to the smoothed coordinate for fluid following
          if (mapRef.current) {
            mapRef.current.animateCamera(
              {
                center: {
                  latitude: smoothedCoordinate.latitude,
                  longitude: smoothedCoordinate.longitude,
                },
                // You can adjust zoom, pitch, heading here for more control
                // zoom: 16,
                // pitch: 0,
                // heading: 0,
              },
              { duration: 500 }, // Smooth transition duration in milliseconds
            )
          }

          const lastCoord = lastCoordinateRef.current
          if (lastCoord) {
            const distanceIncrement = calculateDistance(
              lastCoord.latitude,
              lastCoord.longitude,
              smoothedCoordinate.latitude,
              smoothedCoordinate.longitude,
            )
            console.log(`MapScreen: Raw distance increment: ${distanceIncrement.toFixed(2)}m from previous point`)

            const filteredIncrement = distanceIncrement >= distanceThreshold ? distanceIncrement : 0
            if (filteredIncrement === 0 && distanceIncrement > 0) {
              console.log(
                `MapScreen: Filtered out small movement (${distanceIncrement.toFixed(2)}m < ${distanceThreshold}m threshold)`,
              )
            }

            setStats((prevStats) => {
              const newDistance = Number(prevStats.distance) + Number(filteredIncrement)
              const duration = Math.floor((new Date() - startTimeRef.current) / 1000)
              const metrics = calculateMetrics(newDistance, duration)

              if (filteredIncrement > 0) {
                console.log(
                  `MapScreen: Updated stats: distance=${newDistance.toFixed(2)}m, duration=${duration}s, raw pace=${metrics.rawPace?.toFixed(2)}, smoothed pace=${metrics.pace?.toFixed(2)}`,
                )
              }

              return {
                ...prevStats,
                distance: newDistance,
                duration,
                ...metrics,
              }
            })
          } else {
            console.log("MapScreen: No previous coordinate available for distance calculation")
          }

          setCoordinates((prev) => [...prev, smoothedCoordinate])
          lastCoordinateRef.current = smoothedCoordinate
        },
      )
      setWatchId(id)
    } catch (err) {
      console.error("MapScreen: Start tracking error:", err)
      setError("Failed to start tracking.")
      stopTracking()
    } finally {
      setIsTrackingLoading(false)
    }
  }

  const smoothCoordinate = (previousCoordinates, newCoordinate) => {
    if (previousCoordinates.length < 2) return newCoordinate

    let totalWeight = 0
    let weightedLat = 0
    let weightedLng = 0

    previousCoordinates.forEach((coord, index) => {
      const weight = (index + 1) / (coord.accuracy || 20)
      totalWeight += weight
      weightedLat += coord.latitude * weight
      weightedLng += coord.longitude * weight
    })

    const currentWeight = previousCoordinates.length / (newCoordinate.accuracy || 20)
    totalWeight += currentWeight
    weightedLat += newCoordinate.latitude * currentWeight
    weightedLng += newCoordinate.longitude * currentWeight

    return {
      ...newCoordinate,
      latitude: weightedLat / totalWeight,
      longitude: weightedLng / totalWeight,
    }
  }

  const handlePause = async () => {
    console.log("MapScreen: Pausing tracking")
    setIsTrackingLoading(true)
    try {
      if (watchId && typeof watchId.remove === "function") {
        watchId.remove()
        setWatchId(null)
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setTracking(false)
      setIsPaused(true) // Set paused state
      await startLocationUpdates() // Keep GPS active for current location display
    } catch (err) {
      console.error("MapScreen: Pause tracking error:", err)
      setError("Failed to pause tracking.")
    } finally {
      setIsTrackingLoading(false)
    }
  }

  const stopTracking = async () => {
    console.log("MapScreen: Stopping tracking (final)")
    setIsTrackingLoading(true)
    try {
      if (watchId && typeof watchId.remove === "function") {
        watchId.remove()
        setWatchId(null)
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setTracking(false)
      setIsPaused(false) // Not paused, but stopped
      setFollowingSuggestedRoute(false)
      await startLocationUpdates() // Keep GPS active for current location display
    } catch (err) {
      console.error("MapScreen: Stop tracking error:", err)
      setError("Failed to stop tracking.")
    } finally {
      setIsTrackingLoading(false)
    }
  }

  const handleDiscard = () => {
    showModal(
      "Discard Activity",
      "Are you sure you want to discard this activity? All progress will be lost.",
      null, // No default onConfirm
      "danger", // Type for error icon
      "trash", // Specific icon
      [
        {
          label: "Yes, Discard",
          action: () => {
            console.log("MapScreen: Discarding activity confirmed")
            setCoordinates([])
            setStats({ distance: 0, duration: 0, pace: 0, avgSpeed: 0 })
            setIsPaused(false)
            setTracking(false)
            setFollowingSuggestedRoute(false)
            setSuggestedRoute(null)
            setShowSuggestedRoute(false)
            recentPacesRef.current = []
            setSmoothedPace(0)
            navigateToActivity({ activityType })
            return true // This action will close the modal
          },
          style: "danger",
        },
        {
          label: "Cancel",
          action: () => {
            return true // This action will close the modal
          },
          style: "secondary",
        },
      ],
    )
    return false // IMPORTANT: Return false to prevent the *calling* modal from closing immediately
  }

  // Enhanced saveActivity with quest completion logic (same as ActivityScreen)
  const saveActivity = async () => {
    console.log("MapScreen: Starting save activity process")
    setIsTrackingLoading(true)

    try {
      const user = auth.currentUser
      if (!user) {
        showModal("Error", "You must be logged in to save activities.", null, "error", "user-times")
        setIsTrackingLoading(false)
        return
      }

      console.log("MapScreen: Validating activity data")
      if (stats.distance < 10) {
        showModal(
          "Activity Too Short",
          "Your activity was too short to save. Please track a longer distance.",
          returnToActivity,
          "info",
          "exclamation-triangle",
        )
        setIsTrackingLoading(false)
        return
      }

      console.log("MapScreen: Calculating activity metrics")
      const distanceInKm = stats.distance / 1000
      const durationInHours = stats.duration / 3600
      const durationInMinutes = stats.duration / 60
      const calculatedMetrics = {
        distanceInKm,
        avgSpeed: durationInHours > 0 ? distanceInKm / durationInHours : 0,
        pace: distanceInKm > 0 ? durationInMinutes / distanceInKm : 0, // minutes per km
      }
      console.log("MapScreen: Calculated GPS metrics:", calculatedMetrics)

      const activityData = {
        userId: user.uid,
        activityType,
        distance: distanceInKm,
        duration: stats.duration,
        pace: stats.pace,
        avgSpeed: calculatedMetrics.avgSpeed,
        coordinates: coordinates.map((coord) => ({
          latitude: coord.latitude,
          longitude: coord.longitude,
          timestamp: coord.timestamp,
        })),
        targetDistance: Number.parseFloat(targetDistance),
        targetTime: Number.parseInt(targetTime),
        createdAt: serverTimestamp(),
        followedSuggestedRoute: followingSuggestedRoute,
      }

      let questCompleted = false
      let xpEarned = 50 // Base XP for completing an activity
      let questCompletionData = null

      // Quest completion logic (using quest data from Dashboard)
      if (selectedQuest) {
        console.log("MapScreen: Processing quest completion for:", selectedQuest)
        activityData.questId = selectedQuest.id
        activityData.questTitle = selectedQuest.title
        activityData.questDescription = selectedQuest.description
        activityData.questCategory = selectedQuest.category

        // Calculate quest progress based on different units
        let questProgress = 0
        let currentValue = 0
        if (selectedQuest.unit === "distance" || selectedQuest.unit === "km") {
          currentValue = distanceInKm
          questProgress = currentValue / selectedQuest.goal
        } else if (selectedQuest.unit === "duration" || selectedQuest.unit === "minutes") {
          currentValue = durationInMinutes
          questProgress = currentValue / selectedQuest.goal
        } else if (selectedQuest.unit === "pace") {
          currentValue = stats.pace
          questProgress = currentValue > 0 && currentValue <= selectedQuest.goal ? 1 : 0
        } else if (selectedQuest.unit === "calories") {
          currentValue = stats.calories || 0
          questProgress = currentValue / selectedQuest.goal
        }

        questCompleted = questProgress >= 1
        activityData.questProgress = Math.min(questProgress, 1)
        activityData.questStatus = questCompleted ? "completed" : "in_progress"

        console.log("MapScreen: Quest progress calculated:", {
          unit: selectedQuest.unit,
          currentValue,
          goal: selectedQuest.goal,
          progress: questProgress,
          completed: questCompleted,
        })

        if (questCompleted) {
          xpEarned += selectedQuest.xpReward || 0
          // Prepare quest completion data
          questCompletionData = {
            questId: selectedQuest.id,
            userId: user.uid,
            questTitle: selectedQuest.title,
            questDescription: selectedQuest.description,
            questGoal: selectedQuest.goal,
            questUnit: selectedQuest.unit,
            achievedValue: currentValue,
            activityType: activityType,
            xpEarned: selectedQuest.xpReward || 0,
            completedAt: serverTimestamp(),
            activityData: {
              distance: distanceInKm,
              duration: durationInMinutes,
              avgSpeed: calculatedMetrics.avgSpeed,
            },
          }
          console.log("MapScreen: Quest completed! Completion data:", questCompletionData)

          // Save quest completion to Firestore
          try {
            await addDoc(collection(db, "quest_completions"), questCompletionData)
            console.log("MapScreen: Quest completion saved to Firestore")
          } catch (error) {
            console.error("MapScreen: Error saving quest completion:", error)
            // Don't fail the entire save operation if quest completion fails
          }
        }
      }

      // Calculate bonus XP based on performance
      let bonusXP = 0
      bonusXP += Math.floor(distanceInKm) * 10 // 10 XP per km
      bonusXP += Math.floor(stats.duration / 600) * 5 // 5 XP per 10 minutes
      xpEarned += bonusXP
      activityData.xpEarned = xpEarned
      activityData.bonusXP = bonusXP
      console.log("MapScreen: Total XP calculated:", {
        baseXP: 50,
        questXP: selectedQuest?.xpReward || 0,
        bonusXP,
        totalXP: xpEarned,
      })

      // Update user's XP and level in Firestore
      try {
        const userRef = doc(db, "users", user.uid)
        const userDoc = await getDoc(userRef)
        if (userDoc.exists()) {
          const userData = userDoc.data()
          const currentXP = userData.totalXP || 0
          const currentLevel = userData.level || 1
          const newTotalXP = currentXP + xpEarned
          const newLevel = Math.floor(newTotalXP / 1000) + 1
          console.log("MapScreen: Updating user XP:", { currentXP, newTotalXP, currentLevel, newLevel })

          // Prepare user update data
          const userUpdateData = {
            totalXP: newTotalXP,
            level: newLevel,
            lastActivityDate: serverTimestamp(),
            totalActivities: (userData.totalActivities || 0) + 1,
            totalDistance: (userData.totalDistance || 0) + distanceInKm,
            totalDuration: (userData.totalDuration || 0) + stats.duration,
          }
          await updateDoc(userRef, userUpdateData)
          console.log("MapScreen: User data updated successfully")

          // Update local state
          setUserStats((prev) => ({
            ...prev,
            totalXP: newTotalXP,
            level: newLevel,
          }))

          // Check for level up
          if (newLevel > currentLevel) {
            setTimeout(() => {
              showModal(
                "Level Up!",
                `Congratulations! You've reached level ${newLevel}! Keep up the great work!`,
                () => {},
                "success",
                "star",
              )
            }, 2000)
          }
        } else {
          console.error("MapScreen: User document does not exist")
        }
      } catch (error) {
        console.error("MapScreen: Error updating user XP:", error)
        // Don't fail the entire save operation if user update fails
      }

      // Save activity to Firestore
      console.log("MapScreen: Saving activity to Firestore:", activityData)
      const activityDocRef = await addDoc(collection(db, "activities"), activityData)
      console.log("MapScreen: Activity saved with ID:", activityDocRef.id)

      // Prepare success message based on quest completion
      let successTitle = "Activity Saved"
      let successMessage = ""
      if (questCompleted) {
        successTitle = "Quest Completed!"
        successMessage = `🎉 Congratulations! You completed the "${selectedQuest?.title}" quest and earned ${xpEarned} XP!

📊 Workout Summary:
• ${distanceInKm.toFixed(2)} km distance
• ${formatTime(stats.duration)} duration
• ${calculatedMetrics.avgSpeed.toFixed(1)} km/h avg speed`
      } else {
        successTitle = "Great Workout!"
        successMessage = `🏃‍♂️ Great ${activityType} session!

📊 Workout Summary:
• ${distanceInKm.toFixed(2)} km covered
• ${formatTime(stats.duration)} duration
• ${calculatedMetrics.avgSpeed.toFixed(1)} km/h avg speed
• ${xpEarned} XP earned`
      }

      // Add bonus XP message if applicable
      if (bonusXP > 0) {
        successMessage += `
🌟 Bonus: +${bonusXP} XP for excellent performance!`
      }

      console.log("MapScreen: Activity saved successfully, showing success message")
      showModal(
        successTitle,
        successMessage,
        () => {
          // Reset states after successful save
          setCoordinates([])
          setStats({ distance: 0, duration: 0, pace: 0, avgSpeed: 0 })
          setIsPaused(false)
          setTracking(false)
          setFollowingSuggestedRoute(false)
          setSuggestedRoute(null)
          setShowSuggestedRoute(false)
          recentPacesRef.current = []
          setSmoothedPace(0)
          returnToActivity()
        },
        "success",
        "check-circle",
      )
    } catch (error) {
      console.error("MapScreen: Error saving activity:", error)
      // Provide more specific error messages
      let errorMessage = "Failed to save activity. Please try again."
      if (error.code === "permission-denied") {
        errorMessage = "You don't have permission to save this activity. Please check your login status."
      } else if (error.code === "network-request-failed") {
        errorMessage = "Network error. Please check your internet connection and try again."
      } else if (error.code === "quota-exceeded") {
        errorMessage = "Storage quota exceeded. Please contact support."
      }
      showModal("Error", errorMessage, null, "error", "exclamation-circle")
    } finally {
      setIsTrackingLoading(false)
    }
  }

  console.log("MapScreen: Rendering with selectedQuest:", selectedQuest)

  // Determine current activity state for button logic
  const isActivityIdle = !tracking && !isPaused && coordinates.length === 0
  const isActivityTracking = tracking
  const isActivityPaused = !tracking && isPaused
  const isActivityEnded = !tracking && !isPaused && coordinates.length > 0

  // Render loading state
  if (loading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size={isSmallDevice ? "small" : "large"} color={currentActivity.color} />
        <CustomText style={twrnc`text-white mt-4 ${isSmallDevice ? "text-sm" : "text-base"}`}>
          Initializing GPS...
        </CustomText>
      </View>
    )
  }

  // Render error state
  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center p-4`}>
        <FontAwesome name="exclamation-circle" size={48} color="#EF4444" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-white text-center mb-4 ${isSmallDevice ? "text-sm" : "text-base"}`}>
          {error}
        </CustomText>
        <TouchableOpacity
          style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg ${isAndroid ? "active:opacity-70" : ""}`}
          activeOpacity={0.7}
          onPress={() => {
            setError(null)
            startLocationUpdates()
          }}
        >
          <CustomText style={twrnc`text-white ${isSmallDevice ? "text-sm" : "text-base"}`}>Try Again</CustomText>
        </TouchableOpacity>
      </View>
    )
  }

  // Main component render
  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      {/* Modal */}
      <CustomModal
        visible={modalVisible}
        title={modalContent.title}
        message={modalContent.message}
        onConfirm={modalContent.onConfirm}
        onCancel={() => setModalVisible(false)} // Default cancel action
        onClose={() => setModalVisible(false)} // General close handler
        type={modalContent.type}
        icon={modalContent.icon}
        buttons={modalContent.buttons} // Pass the new buttons array
      />

      {/* Enhanced Header */}
      <Animated.View style={[twrnc`z-10`, { transform: [{ translateY: headerSlideAnim }], opacity: fadeAnim }]}>
        <LinearGradient
          colors={[currentActivity.color, currentActivity.darkColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={twrnc`px-4 pt-12 pb-4 rounded-b-2xl shadow-lg`}
        >
          <View style={twrnc`flex-row items-center justify-between mb-3`}>
            <TouchableOpacity
              onPress={returnToActivity}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              disabled={isTrackingLoading}
              style={twrnc`p-2 bg-white bg-opacity-20 rounded-full`}
            >
              <Icon name="angle-left" size={isSmallDevice ? 20 : 24} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={twrnc`flex-1 items-center mx-4`}>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-lg" : "text-xl"} mb-1`}>
                {selectedQuest ? selectedQuest.title : activityType.charAt(0).toUpperCase() + activityType.slice(1)}
              </CustomText>
              <View style={twrnc`flex-row items-center`}>
                <View style={twrnc`bg-white bg-opacity-20 rounded-full px-2 py-1 mr-2`}>
                  <CustomText style={twrnc`text-white text-xs font-medium`}>Level {userStats.level}</CustomText>
                </View>
                <View style={twrnc`bg-white bg-opacity-20 rounded-full px-2 py-1`}>
                  <CustomText style={twrnc`text-[#FFC107] text-xs font-medium`}>{userStats.totalXP} XP</CustomText>
                </View>
              </View>
            </View>
            <TouchableOpacity
              onPress={centerMap}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              disabled={isTrackingLoading}
              style={twrnc`p-2 bg-white bg-opacity-20 rounded-full`}
            >
              <FontAwesome name="compass" size={isSmallDevice ? 16 : 20} color="#fff" />
            </TouchableOpacity>
          </View>
          {/* XP Progress Bar */}
          <View style={twrnc`bg-white bg-opacity-20 rounded-full h-2 overflow-hidden`}>
            <View
              style={[
                twrnc`h-2 rounded-full`,
                {
                  width: `${((userStats.totalXP % 1000) / 1000) * 100}%`,
                  backgroundColor: "#FFC107",
                },
              ]}
            />
          </View>
        </LinearGradient>
      </Animated.View>

      {/* Map View */}
      <MapView
        ref={mapRef}
        style={twrnc`flex-1`}
        provider={PROVIDER_GOOGLE}
        initialRegion={currentLocation}
        showsUserLocation={true}
        showsMyLocationButton={false}
        // Removed followsUserLocation={tracking} to manually control camera for smoother following
        loadingEnabled={true}
        moveOnMarkerPress={false}
        toolbarEnabled={false}
        mapType="standard"
        customMapStyle={[
          {
            featureType: "road",
            elementType: "geometry",
            stylers: [{ color: "#808080" }],
          },
          {
            featureType: "road",
            elementType: "labels.text.fill",
            stylers: [{ color: "#FFFFFF" }],
          },
          {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#0e1626" }],
          },
        ]}
      >
        {/* Current position marker when not tracking */}
        {!tracking && currentLocation && (
          <Marker
            coordinate={{
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude,
            }}
          >
            <View style={twrnc`items-center`}>
              <View
                style={twrnc`bg-[${currentActivity.color}] p-2 rounded-full border-2 border-white items-center justify-center`}
              >
                <Ionicons name={currentActivity.icon} size={16} color="white" />
              </View>
              <View
                style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
              />
            </View>
          </Marker>
        )}

        {/* Suggested route polyline */}
        {showSuggestedRoute && suggestedRoute && (
          <>
            {/* Glow effect for Strava-like polish */}
            <Polyline
              coordinates={suggestedRoute.coordinates}
              strokeColor={followingSuggestedRoute ? currentActivity.strokeColor : "#3B82F6"}
              strokeWidth={followingSuggestedRoute ? 10 : 8}
              lineDashPattern={null}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
              style={{ opacity: 0.3 }}
            />
            {/* Main polyline */}
            <Polyline
              coordinates={suggestedRoute.coordinates}
              strokeColor={followingSuggestedRoute ? currentActivity.strokeColor : "#3B82F6"}
              strokeWidth={followingSuggestedRoute ? 6 : 4}
              lineDashPattern={null}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
              tappable={true}
              onPress={() => {
                showModal(
                  "Suggested Route",
                  `Follow this ${suggestedRoute.distance} km ${suggestedRoute.routeType} route?`,
                  () => {
                    setFollowingSuggestedRoute(true)
                  },
                  "info",
                  "map-signs",
                )
              }}
            />
            {/* Waypoint markers */}
            {suggestedRoute.waypoints.map((waypoint, index) => (
              <Marker
                key={`waypoint-${index}`}
                coordinate={{
                  latitude: waypoint.latitude,
                  longitude: waypoint.longitude,
                }}
                title={waypoint.name}
                description={waypoint.type}
              >
                <View style={twrnc`items-center`}>
                  <View
                    style={twrnc`p-2 rounded-full border-2 border-white ${
                      waypoint.type === "start"
                        ? "bg-green-500"
                        : waypoint.type === "end"
                          ? "bg-red-500"
                          : "bg-blue-500"
                    }`}
                  >
                    <FontAwesome
                      name={waypoint.type === "start" ? "play" : waypoint.type === "end" ? "stop" : "map-marker"}
                      size={16}
                      color="white"
                    />
                  </View>
                  <View
                    style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
                  />
                </View>
              </Marker>
            ))}
          </>
        )}

        {/* Actual tracking path */}
        {coordinates.length > 0 && (
          <>
            <Polyline
              coordinates={coordinates}
              strokeColor={currentActivity.strokeColor}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
            />
            {coordinates.length > 1 && !followingSuggestedRoute && (
              <>
                <Marker coordinate={coordinates[0]}>
                  <View style={twrnc`items-center`}>
                    <View style={twrnc`bg-green-500 p-2 rounded-full border-2 border-white`}>
                      <FontAwesome name="flag" size={16} color="white" />
                    </View>
                    <View
                      style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
                    />
                  </View>
                </Marker>
                <Marker coordinate={coordinates[coordinates.length - 1]}>
                  <View style={twrnc`items-center`}>
                    <View style={twrnc`bg-red-500 p-2 rounded-full border-2 border-white`}>
                      <FontAwesome name="flag" size={16} color="white" />
                    </View>
                    <View
                      style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
                    />
                  </View>
                </Marker>
              </>
            )}
          </>
        )}
      </MapView>

      {/* Route generation button */}
      {!tracking && !showSuggestedRoute && (
        <Animated.View
          style={{
            position: "absolute",
            top: 140,
            right: 16,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            zIndex: 10,
          }}
        >
          <TouchableOpacity
            style={twrnc`shadow-lg ${isAndroid ? "elevation-5" : ""}`}
            onPress={handleGenerateRoute}
            disabled={isGeneratingRoute || !currentLocation}
          >
            <LinearGradient
              colors={[currentActivity.color, currentActivity.darkColor]}
              style={twrnc`w-12 h-12 rounded-full items-center justify-center border-2 border-white`}
            >
              {isGeneratingRoute ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <FontAwesome name="map" size={20} color="white" />
              )}
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Route info panel */}
      {showSuggestedRoute && suggestedRoute && !tracking && (
        <Animated.View
          style={{
            position: "absolute",
            top: 200,
            left: 16,
            right: 16,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            zIndex: 10,
          }}
        >
          <LinearGradient
            colors={["#2A2E3A", "#1E2538"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={twrnc`p-4 rounded-2xl shadow-lg ${isAndroid ? "elevation-5" : ""}`}
          >
            <View style={twrnc`flex-row items-center justify-between`}>
              <View style={twrnc`flex-1`}>
                <CustomText weight="bold" style={twrnc`text-white text-base mb-1`}>
                  {suggestedRoute.name}
                </CustomText>
                <View style={twrnc`flex-row items-center mt-1`}>
                  <FontAwesome name="map-o" size={14} color="#9CA3AF" style={twrnc`mr-2`} />
                  <CustomText style={twrnc`text-gray-400 text-sm`}>
                    {suggestedRoute.distance} km • {suggestedRoute.difficulty} • {suggestedRoute.routeType || "route"}
                  </CustomText>
                </View>
              </View>
              <TouchableOpacity onPress={clearSuggestedRoute} style={twrnc`bg-[#3A3F4B] p-2 rounded-full ml-3`}>
                <FontAwesome name="times" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>
      )}

      {/* Active Quest Display (from Dashboard) */}
      {selectedQuest && (
        <Animated.View
          style={{
            position: "absolute",
            top: showSuggestedRoute ? 280 : 200,
            left: 16,
            right: 16,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }, { scale: questPulseAnim }],
            zIndex: 10,
          }}
        >
          <LinearGradient
            colors={["#4361EE", "#3A0CA3"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={twrnc`p-4 rounded-2xl shadow-lg ${isAndroid ? "elevation-5" : ""}`}
          >
            <View style={twrnc`flex-row items-center justify-between mb-3`}>
              <View style={twrnc`flex-row items-center flex-1`}>
                <View style={twrnc`bg-white bg-opacity-20 rounded-full p-2 mr-3`}>
                  <FontAwesome name="trophy" size={18} color="#FFD166" />
                </View>
                <View style={twrnc`flex-1`}>
                  <CustomText weight="bold" style={twrnc`text-white text-base mb-1`}>
                    {selectedQuest.title}
                  </CustomText>
                  <CustomText style={twrnc`text-white text-opacity-80 text-sm`}>{selectedQuest.description}</CustomText>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedQuest(null)}
                style={twrnc`bg-white bg-opacity-20 p-2 rounded-full`}
              >
                <FontAwesome name="times" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={twrnc`mb-2`}>
              <View style={twrnc`flex-row justify-between items-center mb-2`}>
                <CustomText style={twrnc`text-white text-opacity-90 text-sm`}>Progress</CustomText>
                <CustomText weight="bold" style={twrnc`text-white text-sm`}>
                  {Math.round(getDisplayQuestProgress(selectedQuest) * 100)}%
                </CustomText>
              </View>
              <View style={twrnc`h-3 bg-white bg-opacity-20 rounded-full overflow-hidden`}>
                <View
                  style={[
                    twrnc`h-3 rounded-full`,
                    {
                      width: `${Math.min(getDisplayQuestProgress(selectedQuest) * 100, 100)}%`,
                      backgroundColor: getDisplayQuestProgress(selectedQuest) >= 1 ? "#06D6A0" : "#FFD166",
                    },
                  ]}
                />
              </View>
            </View>
            <View style={twrnc`flex-row justify-between items-center`}>
              <CustomText style={twrnc`text-white text-opacity-80 text-xs`}>
                Current:{" "}
                {selectedQuest.unit === "reps"
                  ? `${getCurrentQuestValue(selectedQuest)} reps`
                  : selectedQuest.unit === "duration" || selectedQuest.unit === "minutes"
                    ? `${getCurrentQuestValue(selectedQuest)} min`
                    : selectedQuest.unit === "distance" || selectedQuest.unit === "km"
                      ? `${getCurrentQuestValue(selectedQuest).toFixed(2)} km`
                      : selectedQuest.unit === "pace"
                        ? `${formatPace(stats.pace)}`
                        : `${getCurrentQuestValue(selectedQuest)} ${selectedQuest.unit}`}
              </CustomText>
              <View style={twrnc`bg-[#FFD166] px-2 py-1 rounded-full`}>
                <CustomText weight="bold" style={twrnc`text-[#121826] text-xs`}>
                  +{selectedQuest.xpReward} XP
                </CustomText>
              </View>
            </View>
            <View style={twrnc`flex-row justify-between items-center mt-2`}>
              <CustomText style={twrnc`text-white text-opacity-60 text-xs`}>
                Goal:{" "}
                {selectedQuest.unit === "reps"
                  ? `${selectedQuest.goal} reps`
                  : selectedQuest.unit === "duration" || selectedQuest.unit === "minutes"
                    ? `${selectedQuest.goal} min`
                    : selectedQuest.unit === "distance" || selectedQuest.unit === "km"
                      ? `${selectedQuest.goal} km`
                      : selectedQuest.unit === "pace"
                        ? `${formatPace(selectedQuest.goal)}`
                        : `${selectedQuest.goal} ${selectedQuest.unit}`}
              </CustomText>
            </View>
            {getQuestStatus(selectedQuest) === "completed" && (
              <View style={twrnc`mt-4 bg-[#06D6A0] bg-opacity-20 rounded-xl p-3 flex-row items-center`}>
                <Ionicons name="checkmark-circle" size={20} color="#06D6A0" style={twrnc`mr-2`} />
                <CustomText weight="bold" style={twrnc`text-[#06D6A0] text-sm`}>
                  Quest Completed! Great job!
                </CustomText>
              </View>
            )}
          </LinearGradient>
        </Animated.View>
      )}

      {/* Draggable GPS Signal Indicator */}
      <Animated.View
        style={{
          position: "absolute",
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
          zIndex: 20,
        }}
        {...panResponder.panHandlers}
      >
        <LinearGradient
          colors={["#2A2E3A", "#1E2538"]}
          style={twrnc`flex-row items-center px-3 py-2 rounded-full shadow-lg`}
        >
          <FontAwesome
            name="signal"
            size={14}
            color={
              gpsSignal === "Excellent"
                ? "#06D6A0"
                : gpsSignal === "Good"
                  ? "#4361EE"
                  : gpsSignal === "Fair"
                    ? "#FFC107"
                    : "#EF476F"
            }
          />
          <CustomText style={twrnc`text-white ml-2 text-xs font-medium`}>GPS: {gpsSignal}</CustomText>
          <View style={twrnc`ml-2 bg-gray-500 rounded-full h-1 w-1`} />
        </LinearGradient>
      </Animated.View>

      {/* Streamlined Stats & Controls */}
      <Animated.View
        style={[
          twrnc`absolute bottom-4 left-4 right-4`,
          { opacity: fadeAnim, transform: [{ translateY: statsSlideAnim }], zIndex: 10 },
        ]}
      >
        <LinearGradient
          colors={["#2A2E3A", "#1E2538"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={twrnc`p-4 rounded-2xl shadow-lg ${isAndroid ? "elevation-5" : ""}`}
        >
          {/* Streamlined Stats Grid - 3 columns instead of 4 */}
          <View style={twrnc`flex-row justify-between mb-4`}>
            <View style={twrnc`items-center flex-1`}>
              <View style={twrnc`flex-row items-center mb-1`}>
                <Ionicons name="map-outline" size={16} color="#06D6A0" style={twrnc`mr-1`} />
                <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"}`}>Distance</CustomText>
              </View>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-xl" : "text-2xl"}`}>
                {(stats.distance / 1000).toFixed(2)}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"}`}>km</CustomText>
              {targetDistance !== "0" && (
                <CustomText style={twrnc`text-[#06D6A0] ${isSmallDevice ? "text-2xs" : "text-xs"} mt-1`}>
                  Target: {targetDistance} km
                </CustomText>
              )}
            </View>

            <View style={twrnc`items-center flex-1`}>
              <View style={twrnc`flex-row items-center mb-1`}>
                <Ionicons name="time-outline" size={16} color="#4361EE" style={twrnc`mr-1`} />
                <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"}`}>Duration</CustomText>
              </View>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-xl" : "text-2xl"}`}>
                {formatTime(stats.duration)}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"}`}>time</CustomText>
              {targetTime !== "0" && (
                <CustomText style={twrnc`text-[#4361EE] ${isSmallDevice ? "text-2xs" : "text-xs"} mt-1`}>
                  Target: {targetTime} min
                </CustomText>
              )}
            </View>

            <View style={twrnc`items-center flex-1`}>
              <View style={twrnc`flex-row items-center mb-1`}>
                <Ionicons name="speedometer-outline" size={16} color="#FFC107" style={twrnc`mr-1`} />
                <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"}`}>Pace</CustomText>
              </View>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-xl" : "text-2xl"}`}>
                {formatPace(stats.pace)}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"}`}>/km</CustomText>
              <CustomText style={twrnc`text-[#FFC107] ${isSmallDevice ? "text-2xs" : "text-xs"} mt-1`}>
                {stats.avgSpeed.toFixed(1)} km/h
              </CustomText>
            </View>
          </View>

          {/* Enhanced Start / Pause / Resume Button */}
          {!isActivityEnded && ( // Hide this button when activity is ended and awaiting save/discard
            <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
              <TouchableOpacity
                style={[
                  twrnc`py-4 rounded-2xl items-center flex-row justify-center shadow-lg`,
                  {
                    backgroundColor: isActivityTracking ? "#EF476F" : currentActivity.color,
                    shadowColor: isActivityTracking ? "#EF476F" : currentActivity.color,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 8,
                  },
                  isTrackingLoading && twrnc`opacity-60`,
                ]}
                activeOpacity={1} // Set to 1 to let Animated.View handle opacity
                onPress={() => {
                  if (isTrackingLoading) return // Prevent multiple presses during loading

                  if (isActivityTracking) {
                    handlePause()
                  } else if (isActivityPaused) {
                    startTracking() // Resumes tracking
                  } else {
                    startTracking() // Starts new tracking
                  }
                }}
                onPressIn={() => handleButtonPressIn(buttonScaleAnim)}
                onPressOut={() => handleButtonPressOut(buttonScaleAnim)}
                disabled={isTrackingLoading}
              >
                {isTrackingLoading ? (
                  <Animated.View style={twrnc`flex-row items-center`}>
                    <ActivityIndicator size="small" color="white" style={twrnc`mr-3`} />
                    <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                      {isActivityTracking ? "Pausing..." : "Starting..."}
                    </CustomText>
                  </Animated.View>
                ) : (
                  <Animated.View style={twrnc`flex-row items-center`}>
                    {isActivityTracking ? (
                      <Animated.View style={{ transform: [{ scale: iconPulseAnim }] }}>
                        <Ionicons
                          name="pause" // Changed to pause icon
                          size={isSmallDevice ? 20 : 24}
                          color="white"
                          style={twrnc`${isSmallDevice ? "mr-2" : "mr-3"}`}
                        />
                      </Animated.View>
                    ) : (
                      <Animated.View style={{ transform: [{ translateX: iconMoveAnim }] }}>
                        <Ionicons
                          name="play"
                          size={isSmallDevice ? 20 : 24}
                          color="white"
                          style={twrnc`${isSmallDevice ? "mr-2" : "mr-3"}`}
                        />
                      </Animated.View>
                    )}
                    <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                      {isActivityTracking
                        ? "Pause"
                        : isActivityPaused
                          ? "Resume"
                          : followingSuggestedRoute
                            ? "Start Following Route"
                            : selectedQuest
                              ? `Start Quest: ${selectedQuest.title}`
                              : "Start Tracking"}
                    </CustomText>
                  </Animated.View>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Save / Discard Buttons (appear when activity is ended) */}
          {isActivityEnded && (
            <Animated.View
              style={[
                twrnc`flex-row justify-between mt-4`,
                {
                  opacity: saveDiscardFadeAnim,
                  transform: [{ translateY: saveDiscardSlideAnim }],
                },
              ]}
            >
              <Animated.View style={{ flex: 1, transform: [{ scale: saveButtonScaleAnim }] }}>
                <TouchableOpacity
                  style={[
                    twrnc`flex-1 py-3 rounded-2xl items-center justify-center mr-2 shadow-lg`,
                    {
                      backgroundColor: "#06D6A0",
                      shadowColor: "#06D6A0",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 8,
                      elevation: 8,
                    },
                    isTrackingLoading && twrnc`opacity-60`,
                  ]}
                  activeOpacity={1}
                  onPress={saveActivity}
                  onPressIn={() => handleButtonPressIn(saveButtonScaleAnim)}
                  onPressOut={() => handleButtonPressOut(saveButtonScaleAnim)}
                  disabled={isTrackingLoading}
                >
                  {isTrackingLoading ? (
                    <View style={twrnc`flex-row items-center`}>
                      <ActivityIndicator size="small" color="white" style={twrnc`mr-2`} />
                      <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                        Saving...
                      </CustomText>
                    </View>
                  ) : (
                    <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                      Save
                    </CustomText>
                  )}
                </TouchableOpacity>
              </Animated.View>
              <Animated.View style={{ flex: 1, transform: [{ scale: discardButtonScaleAnim }] }}>
                <TouchableOpacity
                  style={[
                    twrnc`flex-1 py-3 rounded-2xl items-center justify-center ml-2 shadow-lg`,
                    {
                      backgroundColor: "#EF476F",
                      shadowColor: "#EF476F",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 8,
                      elevation: 8,
                    },
                    isTrackingLoading && twrnc`opacity-60`,
                  ]}
                  activeOpacity={1}
                  onPress={handleDiscard}
                  onPressIn={() => handleButtonPressIn(discardButtonScaleAnim)}
                  onPressOut={() => handleButtonPressOut(discardButtonScaleAnim)}
                  disabled={isTrackingLoading}
                >
                  {isTrackingLoading ? (
                    <View style={twrnc`flex-row items-center`}>
                      <ActivityIndicator size="small" color="white" style={twrnc`mr-2`} />
                      <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                        Discarding...
                      </CustomText>
                    </View>
                  ) : (
                    <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                      Discard
                    </CustomText>
                  )}
                </TouchableOpacity>
              </Animated.View>
            </Animated.View>
          )}
        </LinearGradient>
      </Animated.View>

      {/* Google Maps Attribution */}
      <View style={twrnc`absolute bottom-2 right-2 z-5`}>
        <CustomText style={twrnc`text-gray-400 text-xs`}>Powered by Google Maps</CustomText>
      </View>
    </View>
  )
}

export default MapScreen
