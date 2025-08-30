"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  View,
  TouchableOpacity,
  Image,
  Switch,
  TextInput,
  ScrollView,
  Animated,
  Dimensions,
  Platform,
  StatusBar,
  ActivityIndicator,
  Alert,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import { collection, doc, getDoc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { db, auth } from "../firebaseConfig"
import { Accelerometer } from "expo-sensors"
import FaceProximityPushUpCounter from "../components/FaceProximityPushUpCounter"
// Import icons
import WalkingIcon from "../components/icons/walking.png"
import RunningIcon from "../components/icons/running.png"
import CyclingIcon from "../components/icons/cycling.png"
import JoggingIcon from "../components/icons/jogging.png"
import PushupIcon from "../components/icons/pushup.png"
import SquatIcon from "../components/icons/squat.png"
import SitupIcon from "../components/icons/situp.png"
const { width } = Dimensions.get("window")
const isAndroid = Platform.OS === "android"
const isSmallDevice = width < 375
// Enhanced ButtonSection Component
const ButtonSection = ({
  coordinates,
  isStrengthActivity,
  stats,
  sensorSubscription,
  isTrackingLoading,
  currentActivity,
  activeQuest,
  resumeTracking,
  saveActivity,
  clearActivity,
  startActivity,
  isSmallDevice,
}) => {
  const resumeScale = useRef(new Animated.Value(1)).current
  const saveScale = useRef(new Animated.Value(1)).current
  const clearScale = useRef(new Animated.Value(1)).current
  const startScale = useRef(new Animated.Value(1)).current
  const handlePressIn = (scale) => {
    Animated.spring(scale, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start()
  }
  const handlePressOut = (scale) => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start()
  }
  const handleClearActivity = () => {
    Alert.alert(
      "Clear Activity",
      "Are you sure you want to clear all progress? This action cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Clear",
          style: "destructive",
          onPress: clearActivity,
        },
      ],
      { cancelable: true },
    )
  }
  return (
    <View style={twrnc`w-full px-6 ${isSmallDevice ? "mt-4" : "mt-6"} mb-8`}>
      {coordinates.length > 0 || (isStrengthActivity && stats.reps > 0 && !sensorSubscription) ? (
        <View style={twrnc`flex-col gap-3`}>
          {/* Resume Activity Button - REMOVED */}
          {/* Save Activity Button */}
          {isStrengthActivity && (
            <Animated.View style={{ transform: [{ scale: saveScale }] }}>
              <TouchableOpacity
                style={[
                  twrnc`rounded-2xl py-4 px-6 items-center shadow-lg`,
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
                onPress={saveActivity}
                onPressIn={() => handlePressIn(saveScale)}
                onPressOut={() => handlePressOut(saveScale)}
                disabled={isTrackingLoading}
                activeOpacity={1}
              >
                <View style={twrnc`flex-row items-center`}>
                  <View style={twrnc`bg-white bg-opacity-20 rounded-full p-2 mr-4`}>
                    {isTrackingLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                    )}
                  </View>
                  <View style={twrnc`flex-1`}>
                    <CustomText weight="bold" style={twrnc`text-white text-lg mb-1`}>
                      {isTrackingLoading ? "Saving..." : "Save Activity"}
                    </CustomText>
                    <CustomText style={twrnc`text-white text-opacity-80 text-sm`}>
                      {isTrackingLoading ? "Please wait..." : `Complete your ${stats.reps || 0} reps session`}
                    </CustomText>
                  </View>
                  {!isTrackingLoading && (
                    <Ionicons name="chevron-forward" size={18} color="#FFFFFF" style={twrnc`opacity-60`} />
                  )}
                </View>
              </TouchableOpacity>
            </Animated.View>
          )}
          {/* Clear Activity Button */}
          <Animated.View style={{ transform: [{ scale: clearScale }] }}>
            <TouchableOpacity
              style={[
                twrnc`rounded-2xl py-4 px-6 items-center border-2 border-[#EF476F]`,
                {
                  backgroundColor: "rgba(239, 71, 111, 0.1)",
                },
                isTrackingLoading && twrnc`opacity-60`,
              ]}
              onPress={handleClearActivity}
              onPressIn={() => handlePressIn(clearScale)}
              onPressOut={() => handlePressOut(clearScale)}
              disabled={isTrackingLoading}
              activeOpacity={1}
            >
              <View style={twrnc`flex-row items-center`}>
                <View style={twrnc`bg-[#EF476F] bg-opacity-20 rounded-full p-2 mr-4`}>
                  <Ionicons name="trash" size={18} color="#EF476F" />
                </View>
                <View style={twrnc`flex-1`}>
                  <CustomText weight="bold" style={twrnc`text-[#EF476F] text-lg mb-1`}>
                    Clear Activity
                  </CustomText>
                  <CustomText style={twrnc`text-[#EF476F] text-opacity-80 text-sm`}>
                    Remove all progress and start over
                  </CustomText>
                </View>
                <Ionicons name="warning" size={18} color="#EF476F" style={twrnc`opacity-60`} />
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>
      ) : (
        !sensorSubscription && (
          <Animated.View style={{ transform: [{ scale: startScale }] }}>
            <TouchableOpacity
              style={[
                twrnc`rounded-2xl py-5 px-8 items-center shadow-lg`,
                {
                  backgroundColor: currentActivity.color,
                  shadowColor: currentActivity.color,
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.4,
                  shadowRadius: 10,
                  elevation: 10,
                },
                isTrackingLoading && twrnc`opacity-60`,
              ]}
              onPress={startActivity}
              onPressIn={() => handlePressIn(startScale)}
              onPressOut={() => handlePressOut(startScale)}
              disabled={isTrackingLoading}
              activeOpacity={1}
            >
              <View style={twrnc`flex-row items-center`}>
                <View style={twrnc`bg-white bg-opacity-25 rounded-full p-3 mr-5`}>
                  <Ionicons name="play" size={24} color="#FFFFFF" />
                </View>
                <View style={twrnc`flex-1`}>
                  <CustomText weight="bold" style={twrnc`text-white text-xl mb-1`}>
                    {activeQuest ? "Start Quest" : `Start ${isStrengthActivity ? "Counting" : "Tracking"}`}
                  </CustomText>
                  <CustomText style={twrnc`text-white text-opacity-90 text-base`}>
                    Begin your {currentActivity.name.toLowerCase()} session
                  </CustomText>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#FFFFFF" style={twrnc`opacity-70`} />
              </View>
            </TouchableOpacity>
          </Animated.View>
        )
      )}
    </View>
  )
}
const ActivityScreen = ({ navigateToDashboard, navigateToMap, params = {} }) => {
  console.log("ActivityScreen: Initialized with params:", params)
  const [gpsEnabled, setGpsEnabled] = useState(true)
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState(params.activityType || "walking")
  const [distance, setDistance] = useState(Number(params.distance) || 0)
  const [time, setTime] = useState(Number(params.time) || 0)
  const [calories, setCalories] = useState(0)
  const [coordinates, setCoordinates] = useState(params.coordinates || [])
  const [stats, setStats] = useState(
    params.stats || {
      distance: 0,
      duration: 0,
      pace: 0,
      avgSpeed: 0,
      steps: 0,
      reps: 0,
    },
  )
  // User stats for XP calculation (simplified - no quest generation)
  const [userStats, setUserStats] = useState({
    level: 1,
    totalXP: 0,
  })
  // Enhanced quest state - automatically set from params (received from Dashboard)
  const [activeQuest, setActiveQuest] = useState(null)
  const [questBadge, setQuestBadge] = useState(null)
  const [pulseAnim] = useState(new Animated.Value(1))
  console.log("ActivityScreen: Current activeQuest state:", activeQuest)
  const [showSettings, setShowSettings] = useState(false)
  const [isViewingPastActivity, setIsViewingPastActivity] = useState(params.isViewingPastActivity || false)
  const [repCount, setRepCount] = useState(0)
  const [repGoal, setRepGoal] = useState(params.repGoal || 20)
  const [isTrackingReps, setIsTrackingReps] = useState(false)
  const [accelerometerData, setAccelerometerData] = useState({ x: 0, y: 0, z: 0 })
  const [sensorSubscription, setSensorSubscription] = useState(null)
  const [isTrackingLoading, setIsTrackingLoading] = useState(false)
  const [showFaceCounter, setShowFaceCounter] = useState(false)
  const activities = useMemo(
    () => [
      {
        id: "walking",
        name: "Walking",
        icon: WalkingIcon,
        met: 3.5,
        color: "#4361EE",
        iconColor: "#FFFFFF",
        isGpsActivity: true,
      },
      {
        id: "running",
        name: "Running",
        icon: RunningIcon,
        met: 8.0,
        color: "#EF476F",
        iconColor: "#FFFFFF",
        isGpsActivity: true,
      },
      {
        id: "cycling",
        name: "Cycling",
        icon: CyclingIcon,
        met: 6.0,
        color: "#06D6A0",
        iconColor: "#121826",
        isGpsActivity: true,
      },
      {
        id: "jogging",
        name: "Jogging",
        icon: JoggingIcon,
        met: 7.0,
        color: "#FFC107",
        iconColor: "#121826",
        isGpsActivity: true,
      },
      {
        id: "pushup",
        name: "Push-ups",
        icon: PushupIcon,
        met: 3.8,
        color: "#9B5DE5",
        iconColor: "#FFFFFF",
        isGpsActivity: false,
      },
      {
        id: "squat",
        name: "Squats",
        icon: SquatIcon,
        met: 5.0,
        color: "#F15BB5",
        iconColor: "#FFFFFF",
        isGpsActivity: false,
      },
      {
        id: "situp",
        name: "Sit-ups",
        icon: SitupIcon,
        met: 3.5,
        color: "#00BBF9",
        iconColor: "#FFFFFF",
        isGpsActivity: false,
      },
    ],
    [],
  )
  const currentActivity = useMemo(
    () => activities.find((a) => a.id === selectedActivity) || activities[0],
    [activities, selectedActivity],
  )
  const isStrengthActivity = useMemo(() => !currentActivity.isGpsActivity, [currentActivity])
  // Load user stats from Firestore
  const loadUserStats = useCallback(async () => {
    try {
      const user = auth.currentUser
      if (!user) {
        console.log("ActivityScreen: No user found for loading stats")
        return
      }
      console.log("ActivityScreen: Loading user stats for user:", user.uid)
      const userRef = doc(db, "users", user.uid)
      const userDoc = await getDoc(userRef)
      if (userDoc.exists()) {
        const userData = userDoc.data()
        console.log("ActivityScreen: Loaded user data:", userData)
        setUserStats({
          level: userData.level || 1,
          totalXP: userData.totalXP || 0,
        })
      } else {
        console.log("ActivityScreen: User document does not exist, using defaults")
      }
    } catch (error) {
      console.error("ActivityScreen: Error loading user stats:", error)
    }
  }, [])
  useEffect(() => {
    loadUserStats()
  }, [loadUserStats])
  // Helper function to format duration properly
  const formatDuration = useCallback((seconds) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`
  }, [])
  useEffect(() => {
    if (activeQuest) {
      console.log("ActivityScreen: Starting pulse animation for active quest")
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      ).start()
    }
  }, [activeQuest, pulseAnim])
  // Enhanced quest initialization from params (received from Dashboard)
  useEffect(() => {
    console.log("ActivityScreen: Processing params for quest initialization:", params)
    if (params.questId || (params.title && params.description && params.goal && params.unit)) {
      const questData = {
        id: params.questId || `quest_${Date.now()}`,
        title: params.title,
        description: params.description,
        goal: params.goal,
        unit: params.unit,
        progress: params.progress || 0, // Use progress from MapScreen or Dashboard
        status: params.status || "not_started",
        activityType: params.activityType,
        xpReward: params.xpReward || 50,
        difficulty: params.difficulty || "medium",
        category: params.category || "fitness",
      }
      console.log("ActivityScreen: Setting active quest from params:", questData)
      setActiveQuest(questData)
      // Set the activity type from quest
      if (questData.activityType && questData.activityType !== selectedActivity) {
        console.log("ActivityScreen: Updating activity type from quest:", questData.activityType)
        setSelectedActivity(questData.activityType)
      }
    } else {
      console.log("ActivityScreen: No quest data found in params")
      setActiveQuest(null)
    }
  }, [params, selectedActivity])
  const calculateCalories = useCallback(() => {
    const weight = 70
    const timeInHours = (Number.parseFloat(time) || 0) / 60
    const activity = activities.find((a) => a.id === selectedActivity)
    const kcal = (activity?.met || 3.5) * weight * timeInHours
    return Math.round(kcal)
  }, [time, selectedActivity, activities])
  const calculateTargetDistance = useCallback(() => {
    const timeInHours = (Number.parseFloat(time) || 0) / 60
    const speeds = { walking: 5, running: 10, cycling: 15, jogging: 8 }
    return (timeInHours * (speeds[selectedActivity] || 5)).toFixed(2)
  }, [time, selectedActivity])
  useEffect(() => {
    setCalories(calculateCalories())
  }, [calculateCalories])
  useEffect(() => {
    if (params?.activityType && selectedActivity !== params.activityType) {
      setDistance(calculateTargetDistance())
    }
  }, [selectedActivity, time, calculateTargetDistance, params])
  const handleDistanceChange = useCallback((value) => {
    if (/^\d*\.?\d{0,2}$/.test(value) || value === "") {
      setDistance(value)
    }
  }, [])
  const handleRepGoalChange = useCallback((value) => {
    if (/^\d+$/.test(value) || value === "") {
      setRepGoal(value === "" ? 0 : Number.parseInt(value, 10))
    }
  }, [])
  const startAccelerometerTracking = useCallback(() => {
    console.log("ActivityScreen: Starting accelerometer tracking for", selectedActivity)
    Accelerometer.setUpdateInterval(100)
    const subscription = Accelerometer.addListener((data) => {
      setAccelerometerData(data)
      const magnitude = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z)
      let threshold = 1.2
      if (selectedActivity === "pushup") {
        threshold = 1.3
      } else if (selectedActivity === "squat") {
        threshold = 1.4
      } else if (selectedActivity === "situp") {
        threshold = 1.5
      }
      if (magnitude > threshold && !isTrackingReps) {
        setIsTrackingReps(true)
      } else if (magnitude < 0.8 && isTrackingReps) {
        setIsTrackingReps(false)
        setRepCount((prev) => {
          const newCount = prev + 1
          console.log("ActivityScreen: Rep detected, new count:", newCount)
          return newCount
        })
        setStats((prevStats) => ({
          ...prevStats,
          reps: (prevStats.reps || 0) + 1,
        }))
      }
    })
    setSensorSubscription(subscription)
    return () => {
      subscription.remove()
    }
  }, [selectedActivity, isTrackingReps])
  const stopAccelerometerTracking = useCallback(() => {
    console.log("ActivityScreen: Stopping accelerometer tracking")
    if (sensorSubscription) {
      sensorSubscription.remove()
      setSensorSubscription(null)
    }
  }, [sensorSubscription])
  const incrementRep = useCallback(() => {
    setRepCount((prev) => {
      const newCount = prev + 1
      console.log("ActivityScreen: Manual rep increment, new count:", newCount)
      return newCount
    })
    setStats((prevStats) => ({
      ...prevStats,
      reps: (prevStats.reps || 0) + 1,
    }))
  }, [])
  // Enhanced saveActivity with XP saving and quest completion
  const saveActivity = useCallback(async () => {
    console.log("ActivityScreen: Starting save activity process")
    setIsTrackingLoading(true)
    try {
      const user = auth.currentUser
      if (!user) {
        showModal("Error", "You must be logged in to save activities.")
        setIsTrackingLoading(false)
        return
      }
      console.log("ActivityScreen: Validating activity data")
      // Activity type validation
      if (isStrengthActivity) {
        // Strength activity validation
        if (stats.reps < 5) {
          showModal(
            "Activity Too Short",
            "Your activity was too short to save. Please complete at least 5 repetitions.",
            () => {},
          )
          setIsTrackingLoading(false)
          return
        }
      } else {
        // Distance activity validation
        const minDistance = 0.1 // 0.1 km minimum
        const minDuration = 60 // 1 minute minimum
        if (stats.distance / 1000 < minDistance) {
          showModal(
            "Activity Too Short",
            `Your activity was too short to save. Please cover at least ${minDistance} km.`,
            () => {},
          )
          setIsTrackingLoading(false)
          return
        }
        if (stats.duration < minDuration) {
          showModal(
            "Activity Too Short",
            `Your activity was too short to save. Please exercise for at least ${Math.floor(minDuration / 60)} minute(s).`,
            () => {},
          )
          setIsTrackingLoading(false)
          return
        }
      }
      console.log("ActivityScreen: Calculating activity metrics")
      // Calculate metrics based on activity type
      let calculatedMetrics = {}
      if (!isStrengthActivity) {
        const distanceInKm = (stats.distance || 0) / 1000
        const durationInHours = (stats.duration || 0) / 3600
        const durationInMinutes = (stats.duration || 0) / 60
        calculatedMetrics = {
          distanceInKm,
          avgSpeed: durationInHours > 0 ? distanceInKm / durationInHours : 0,
          pace: distanceInKm > 0 ? durationInMinutes / distanceInKm : 0, // minutes per km
        }
        console.log("ActivityScreen: Calculated GPS metrics:", calculatedMetrics)
      }
      // Base activity data
      const baseActivityData = {
        userId: user.uid,
        activityType: selectedActivity,
        duration: stats.duration || 0,
        calories: calories || 0,
        createdAt: serverTimestamp(),
        videoUrl: null,
        imageUrl: null,
      }
      // Build activity data based on type
      const activityData = isStrengthActivity
        ? {
            ...baseActivityData,
            reps: stats.reps || 0,
            // Add strength-specific fields
            sets: stats.sets || 1,
            restTime: stats.restTime || 0,
          }
        : {
            ...baseActivityData,
            distance: stats.distance || 0, // in meters
            steps: stats.steps || 0,
            avgSpeed: calculatedMetrics.avgSpeed || 0, // km/h
            pace: calculatedMetrics.pace || 0, // min/km
            maxSpeed: stats.maxSpeed || 0,
            elevationGain: stats.elevationGain || 0,
            elevationLoss: stats.elevationLoss || 0,
            coordinates: coordinates || [],
            // Add GPS-specific metadata
            startLocation:
              coordinates && coordinates.length > 0
                ? {
                    latitude: coordinates[0].latitude,
                    longitude: coordinates[0].longitude,
                    timestamp: coordinates[0].timestamp,
                  }
                : null,
            endLocation:
              coordinates && coordinates.length > 0
                ? {
                    latitude: coordinates[coordinates.length - 1].latitude,
                    longitude: coordinates[coordinates.length - 1].longitude,
                    timestamp: coordinates[coordinates.length - 1].timestamp,
                  }
                : null,
          }
      console.log("ActivityScreen: Built activity data:", activityData)
      let questCompleted = false
      let xpEarned = 50 // Base XP for completing an activity
      let questCompletionData = null
      // Quest completion logic (using quest data from Dashboard)
      if (activeQuest) {
        console.log("ActivityScreen: Processing quest completion for:", activeQuest)
        activityData.questId = activeQuest.id
        activityData.questTitle = activeQuest.title
        activityData.questDescription = activeQuest.description
        activityData.questCategory = activeQuest.category
        // Calculate quest progress based on different units
        let questProgress = 0
        let currentValue = 0
        if (activeQuest.unit === "reps" && isStrengthActivity) {
          currentValue = stats.reps || 0
          questProgress = currentValue / activeQuest.goal
        } else if (activeQuest.unit === "distance" && !isStrengthActivity) {
          currentValue = calculatedMetrics.distanceInKm || 0
          questProgress = currentValue / activeQuest.goal
        } else if (activeQuest.unit === "duration") {
          currentValue = (stats.duration || 0) / 60 // Convert to minutes
          questProgress = currentValue / activeQuest.goal
        } else if (activeQuest.unit === "steps" && !isStrengthActivity) {
          currentValue = stats.steps || 0
          questProgress = currentValue / activeQuest.goal
        } else if (activeQuest.unit === "calories") {
          currentValue = calories || 0
          questProgress = currentValue / activeQuest.goal
        }
        questCompleted = questProgress >= 1
        activityData.questProgress = Math.min(questProgress, 1)
        activityData.questStatus = questCompleted ? "completed" : "in_progress"
        console.log("ActivityScreen: Quest progress calculated:", {
          unit: activeQuest.unit,
          currentValue,
          goal: activeQuest.goal,
          progress: questProgress,
          completed: questCompleted,
        })
        if (questCompleted) {
          xpEarned += activeQuest.xpReward || 0
          // Prepare quest completion data
          questCompletionData = {
            questId: activeQuest.id,
            userId: user.uid,
            questTitle: activeQuest.title,
            questDescription: activeQuest.description,
            questGoal: activeQuest.goal,
            questUnit: activeQuest.unit,
            achievedValue: currentValue,
            activityType: selectedActivity,
            xpEarned: activeQuest.xpReward || 0,
            completedAt: serverTimestamp(),
            activityData: {
              ...(isStrengthActivity
                ? {
                    reps: stats.reps || 0,
                    duration: stats.duration || 0,
                  }
                : {
                    distance: calculatedMetrics.distanceInKm || 0,
                    duration: (stats.duration || 0) / 60,
                    avgSpeed: calculatedMetrics.avgSpeed || 0,
                    steps: stats.steps || 0,
                  }),
            },
          }
          console.log("ActivityScreen: Quest completed! Completion data:", questCompletionData)
          // Save quest completion to Firestore
          try {
            await addDoc(collection(db, "quest_completions"), questCompletionData)
            console.log("ActivityScreen: Quest completion saved to Firestore")
          } catch (error) {
            console.error("ActivityScreen: Error saving quest completion:", error)
            // Don't fail the entire save operation if quest completion fails
          }
        }
      }
      // Calculate bonus XP based on performance
      let bonusXP = 0
      if (isStrengthActivity) {
        // Bonus XP for strength activities
        bonusXP += Math.floor((stats.reps || 0) / 10) * 5 // 5 XP per 10 reps
        bonusXP += Math.floor((stats.duration || 0) / 300) * 10 // 10 XP per 5 minutes
      } else {
        // Bonus XP for distance activities
        bonusXP += Math.floor(calculatedMetrics.distanceInKm || 0) * 10 // 10 XP per km
        bonusXP += Math.floor((stats.duration || 0) / 600) * 5 // 5 XP per 10 minutes
        bonusXP += Math.floor((stats.steps || 0) / 1000) * 2 // 2 XP per 1000 steps
      }
      xpEarned += bonusXP
      activityData.xpEarned = xpEarned
      activityData.bonusXP = bonusXP
      console.log("ActivityScreen: Total XP calculated:", {
        baseXP: 50,
        questXP: activeQuest?.xpReward || 0,
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
          console.log("ActivityScreen: Updating user XP:", { currentXP, newTotalXP, currentLevel, newLevel })
          // Prepare user update data
          const userUpdateData = {
            totalXP: newTotalXP,
            level: newLevel,
            lastActivityDate: serverTimestamp(),
            totalActivities: (userData.totalActivities || 0) + 1,
          }
          // Add activity-specific stats
          if (isStrengthActivity) {
            userUpdateData.totalReps = (userData.totalReps || 0) + (stats.reps || 0)
            userUpdateData.totalStrengthDuration = (userData.totalStrengthDuration || 0) + (stats.duration || 0)
          } else {
            userUpdateData.totalDistance = (userData.totalDistance || 0) + (calculatedMetrics.distanceInKm || 0)
            userUpdateData.totalSteps = (userData.totalSteps || 0) + (stats.steps || 0)
            userUpdateData.totalDuration = (userData.totalDuration || 0) + (stats.duration || 0)
          }
          await updateDoc(userRef, userUpdateData)
          console.log("ActivityScreen: User data updated successfully")
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
              )
            }, 2000)
          }
        } else {
          console.error("ActivityScreen: User document does not exist")
        }
      } catch (error) {
        console.error("ActivityScreen: Error updating user XP:", error)
        // Don't fail the entire save operation if user update fails
      }
      // Save activity to Firestore
      console.log("ActivityScreen: Saving activity to Firestore:", activityData)
      const activityDocRef = await addDoc(collection(db, "activities"), activityData)
      console.log("ActivityScreen: Activity saved with ID:", activityDocRef.id)
      // Prepare success message based on activity type and quest completion
      let successTitle = "Activity Saved"
      let successMessage = ""
      if (questCompleted) {
        successTitle = "Quest Completed!"
        if (isStrengthActivity) {
          successMessage = `🎉 Congratulations! You completed the "${activeQuest?.title}" quest and earned ${xpEarned} XP!\n\n📊 Workout Summary:\n• ${stats.reps} ${selectedActivity} reps\n• ${formatDuration(stats.duration)} duration\n• ${calories} calories burned`
        } else {
          successMessage = `🎉 Congratulations! You completed the "${activeQuest?.title}" quest and earned ${xpEarned} XP!\n\n📊 Workout Summary:\n• ${calculatedMetrics.distanceInKm.toFixed(2)} km distance\n• ${formatDuration(stats.duration)} duration\n• ${calculatedMetrics.avgSpeed.toFixed(1)} km/h avg speed\n• ${stats.steps.toLocaleString()} steps\n• ${calories} calories burned`
        }
      } else {
        successTitle = "Great Workout!"
        if (isStrengthActivity) {
          successMessage = `💪 Awesome ${selectedActivity} session!\n\n📊 Workout Summary:\n• ${stats.reps} reps completed\n• ${formatDuration(stats.duration)} duration\n• ${calories} calories burned\n• ${xpEarned} XP earned`
        } else {
          successMessage = `🏃‍♂️ Great ${selectedActivity} session!\n\n📊 Workout Summary:\n• ${calculatedMetrics.distanceInKm.toFixed(2)} km covered\n• ${formatDuration(stats.duration)} duration\n• ${calculatedMetrics.avgSpeed.toFixed(1)} km/h avg speed\n• ${stats.steps.toLocaleString()} steps\n• ${calories} calories burned\n• ${xpEarned} XP earned`
        }
      }
      // Add bonus XP message if applicable
      if (bonusXP > 0) {
        successMessage += `\n🌟 Bonus: +${bonusXP} XP for excellent performance!`
      }
      console.log("ActivityScreen: Activity saved successfully, showing success message")
      showModal(successTitle, successMessage, () => {
        clearActivity()
        navigateToDashboard()
      })
    } catch (error) {
      console.error("ActivityScreen: Error saving activity:", error)
      // Provide more specific error messages
      let errorMessage = "Failed to save activity. Please try again."
      if (error.code === "permission-denied") {
        errorMessage = "You don't have permission to save this activity. Please check your login status."
      } else if (error.code === "network-request-failed") {
        errorMessage = "Network error. Please check your internet connection and try again."
      } else if (error.code === "quota-exceeded") {
        errorMessage = "Storage quota exceeded. Please contact support."
      }
      showModal("Error", errorMessage)
    } finally {
      setIsTrackingLoading(false)
    }
  }, [
    isStrengthActivity,
    selectedActivity,
    stats.reps,
    stats.duration,
    stats.distance,
    stats.steps,
    stats.maxSpeed,
    stats.elevationGain,
    stats.elevationLoss,
    coordinates,
    calories,
    activeQuest,
    navigateToDashboard,
    clearActivity,
    formatDuration,
    showModal,
  ])
  const resumeTracking = useCallback(() => {
    console.log("ActivityScreen: Resuming activity tracking")
    const activityConfig = activities.find((a) => a.id === selectedActivity)
    if (!activityConfig.isGpsActivity) {
      console.log("ActivityScreen: Resuming strength activity tracking")
      startAccelerometerTracking()
      return
    }
    const validCoordinates = coordinates && coordinates.length > 0 ? coordinates : []
    const validStats = {
      distance: typeof stats.distance === "string" ? Number.parseFloat(stats.distance) : stats?.distance || 0,
      duration: stats?.duration || 0,
      pace: stats?.pace || 0,
      avgSpeed: stats?.avgSpeed || 0,
      steps: stats?.steps || 0,
      reps: stats?.reps || 0,
    }
    console.log("ActivityScreen: Resuming GPS activity with stats:", validStats)
    console.log("ActivityScreen: Coordinates count:", validCoordinates.length)
    // Calculate current quest progress if active quest exists
    let currentQuestProgress = 0
    if (activeQuest) {
      currentQuestProgress = getDisplayQuestProgress(activeQuest)
    }
    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: distance || "0",
      targetTime: time || "0",
      tracking: true,
      initialCoordinates: validCoordinates,
      initialStats: validStats,
      activeQuest: activeQuest,
      questProgress: currentQuestProgress, // Pass calculated quest progress
      calories: calories,
      userStats: userStats,
      gpsEnabled: gpsEnabled,
      autoPauseEnabled: autoPauseEnabled,
      isViewingPastActivity: isViewingPastActivity,
      repCount: repCount,
      repGoal: repGoal,
    })
  }, [
    activities,
    selectedActivity,
    distance,
    time,
    coordinates,
    stats,
    navigateToMap,
    activeQuest,
    startAccelerometerTracking,
    calories,
    userStats,
    gpsEnabled,
    autoPauseEnabled,
    isViewingPastActivity,
    repCount,
    repGoal,
    getDisplayQuestProgress, // Add this dependency
  ])
  const startActivity = useCallback(() => {
    console.log("ActivityScreen: Starting activity:", selectedActivity)
    const activityConfig = activities.find((a) => a.id === selectedActivity)
    if (activityConfig.isGpsActivity && !gpsEnabled) {
      alert("GPS Tracking is disabled. Please enable it to start the activity.")
      return
    }
    setStats({
      distance: 0,
      duration: 0,
      pace: 0,
      avgSpeed: 0,
      steps: 0,
      reps: 0,
    })
    if (!activityConfig.isGpsActivity) {
      console.log("ActivityScreen: Starting strength activity tracking")
      setRepCount(0)
      // Show FaceProximityPushUpCounter for pushup
      if (selectedActivity === "pushup") {
        setShowFaceCounter(true)
        return
      }
      startAccelerometerTracking()
      return
    }
    console.log("ActivityScreen: Starting GPS activity, navigating to map")
    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: Number(distance) || 0,
      targetTime: Number(time) || 0,
      tracking: false,
      initialCoordinates: [],
      initialStats: { distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0, reps: 0 },
      activeQuest: activeQuest,
      questProgress: activeQuest ? 0 : undefined,
      calories: 0,
      userStats: userStats,
      gpsEnabled: gpsEnabled,
      autoPauseEnabled: autoPauseEnabled,
      isViewingPastActivity: isViewingPastActivity,
      repCount: 0,
      repGoal: repGoal,
    })
  }, [
    gpsEnabled,
    selectedActivity,
    distance,
    time,
    navigateToMap,
    activeQuest,
    activities,
    startAccelerometerTracking,
    userStats,
    autoPauseEnabled,
    isViewingPastActivity,
    repGoal,
  ])
  const clearActivity = useCallback(() => {
    console.log("ActivityScreen: Clearing activity data")
    setCoordinates([])
    setStats({ distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0, reps: 0 })
    setIsViewingPastActivity(false)
    setRepCount(0)
    stopAccelerometerTracking()
  }, [stopAccelerometerTracking])
  useEffect(() => {
    return () => {
      stopAccelerometerTracking()
    }
  }, [stopAccelerometerTracking])
  // Updated quest progress calculation to use Dashboard data when available
  const getDisplayQuestProgress = useCallback(
    (quest) => {
      if (!quest) {
        console.log("ActivityScreen: No quest provided for progress calculation")
        return 0
      }
      // If we have progress from Dashboard and no current activity, use Dashboard progress
      if (quest.progress !== undefined && stats.steps === 0 && stats.reps === 0 && stats.distance === 0) {
        console.log("ActivityScreen: Using Dashboard progress:", quest.progress)
        return quest.progress
      }
      // Otherwise calculate current progress based on activity stats
      let currentValue = 0
      if (quest.unit === "steps") {
        currentValue = stats.steps
      } else if (quest.unit === "reps") {
        currentValue = stats.reps
      } else if (quest.unit === "distance") {
        currentValue = Number.parseFloat(stats.distance || 0) / 1000
      } else if (quest.unit === "duration") {
        currentValue = stats.duration / 60 // Convert to minutes
      }
      const goalValue = Number.parseFloat(quest.goal || 0)
      const calculatedProgress = Math.min(currentValue / goalValue, 1)
      console.log("ActivityScreen: Calculated quest progress:", {
        unit: quest.unit,
        currentValue,
        goalValue,
        calculatedProgress,
        dashboardProgress: quest.progress,
        usingDashboardProgress:
          quest.progress !== undefined && stats.steps === 0 && stats.reps === 0 && stats.distance === 0,
      })
      return calculatedProgress
    },
    [stats.steps, stats.distance, stats.reps, stats.duration],
  )
  const getQuestStatus = useCallback(
    (quest) => {
      const progress = getDisplayQuestProgress(quest)
      if (progress >= 1) return "completed"
      if (progress > 0) return "in_progress"
      return "not_started"
    },
    [getDisplayQuestProgress],
  )
  // Get current quest value for display
  const getCurrentQuestValue = useCallback(
    (quest) => {
      if (!quest) return 0
      // If we have progress from Dashboard and no current activity, calculate from Dashboard progress
      if (quest.progress !== undefined && stats.steps === 0 && stats.reps === 0 && stats.distance === 0) {
        const dashboardValue = Math.floor(quest.progress * quest.goal)
        console.log("ActivityScreen: Using Dashboard value:", dashboardValue, "from progress:", quest.progress)
        return dashboardValue
      }
      // Otherwise use current activity stats
      if (quest.unit === "steps") {
        return Math.min(stats.steps, quest.goal)
      } else if (quest.unit === "reps") {
        return Math.min(stats.reps, quest.goal)
      } else if (quest.unit === "distance") {
        return Math.min(Number.parseFloat(stats.distance || 0) / 1000, quest.goal)
      } else if (quest.unit === "duration") {
        return Math.min(Math.floor(stats.duration / 60), quest.goal)
      }
      return 0
    },
    [stats.steps, stats.reps, stats.distance, stats.duration],
  )
  // Function to show modal
  const showModal = (title, message, onClose) => {
    alert(`${title}: ${message}`)
    if (onClose) onClose()
  }
  console.log("ActivityScreen: Rendering with activeQuest:", activeQuest)
  // Handler for FaceProximityPushUpCounter rep updates
  const handleFaceCounterRep = useCallback((rep) => {
    setRepCount(rep);
    setStats((prevStats) => ({
      ...prevStats,
      reps: rep,
    }));
  }, []);

  const handleFaceCounterFinish = useCallback(() => {
    setShowFaceCounter(false);
  }, []);

  if (showFaceCounter && selectedActivity === "pushup") {
    return (
      <View style={twrnc`flex-1 bg-[#121826] items-center justify-center`}>
        <FaceProximityPushUpCounter
          repGoal={repGoal}
          onRepUpdate={handleFaceCounterRep}
          onFinish={handleFaceCounterFinish}
        />
      </View>
    );
  }

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <StatusBar barStyle="light-content" backgroundColor="#121826" />
      {/* Enhanced Header */}
      <View style={twrnc`bg-[#2A2E3A] pt-${isAndroid ? "10" : "12"} pb-4 shadow-lg`}>
        <View style={twrnc`flex-row items-center justify-between px-5`}>
          <TouchableOpacity
            style={twrnc`p-2 -ml-2 rounded-full bg-white bg-opacity-10`}
            onPress={navigateToDashboard}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={twrnc`flex-1 items-center`}>
            <CustomText weight="bold" style={twrnc`text-white text-xl`}>
              {activeQuest ? activeQuest.title : currentActivity.name}
            </CustomText>
            <View style={twrnc`flex-row items-center mt-1`}>
              <View style={twrnc`bg-[${currentActivity.color}] px-2 py-1 rounded-full mr-2`}>
                <CustomText style={twrnc`text-white text-xs font-medium`}>Level {userStats.level}</CustomText>
              </View>
              <CustomText style={twrnc`text-gray-400 text-sm`}>{userStats.totalXP} XP</CustomText>
            </View>
          </View>
          <TouchableOpacity
            style={twrnc`p-2 -mr-2 rounded-full bg-white bg-opacity-10`}
            onPress={() => setShowSettings(!showSettings)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name={showSettings ? "close" : "settings-outline"} size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView contentContainerStyle={twrnc`pb-20`} style={twrnc`flex-1`} showsVerticalScrollIndicator={false}>
        {/* Activity Icon Section */}
        <View style={twrnc`items-center justify-center mt-6 mb-8`}>
          <View
            style={[
              twrnc`w-32 h-32 rounded-2xl items-center justify-center mb-6 shadow-lg`,
              { backgroundColor: currentActivity.color, shadowColor: currentActivity.color },
            ]}
          >
            <Image
              source={currentActivity.icon}
              style={[twrnc`w-16 h-16`, { tintColor: currentActivity.iconColor }]}
              resizeMode="contain"
            />
          </View>
          {/* Strength Activity Rep Counter */}
          {isStrengthActivity && sensorSubscription && (
            <View style={twrnc`items-center mb-6`}>
              <CustomText style={twrnc`text-gray-400 text-sm mb-1`}>Reps Completed</CustomText>
              <View style={twrnc`flex-row items-center`}>
                <CustomText weight="bold" style={twrnc`text-white text-5xl`}>
                  {repCount}
                </CustomText>
                <CustomText style={twrnc`text-gray-400 text-lg ml-2`}>/ {repGoal}</CustomText>
              </View>
              <View style={twrnc`w-full max-w-xs mt-4`}>
                <View style={twrnc`h-3 bg-[#2A2E3A] rounded-full overflow-hidden`}>
                  <View
                    style={[
                      twrnc`h-3 rounded-full`,
                      {
                        width: `${Math.min((repCount / repGoal) * 100, 100)}%`,
                        backgroundColor: repCount >= repGoal ? "#06D6A0" : currentActivity.color,
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={twrnc`flex-row mt-6`}>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] rounded-full p-4 mr-4`}
                  onPress={incrementRep}
                  disabled={isTrackingLoading}
                >
                  <Ionicons name="add" size={30} color="#FFFFFF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`bg-[#EF476F] rounded-full p-4`}
                  onPress={stopAccelerometerTracking}
                  disabled={isTrackingLoading}
                >
                  <Ionicons name="stop" size={30} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          )}
          <ButtonSection
            coordinates={coordinates}
            isStrengthActivity={isStrengthActivity}
            stats={stats}
            sensorSubscription={sensorSubscription}
            isTrackingLoading={isTrackingLoading}
            currentActivity={currentActivity}
            activeQuest={activeQuest}
            resumeTracking={resumeTracking}
            saveActivity={saveActivity}
            clearActivity={clearActivity}
            startActivity={startActivity}
            isSmallDevice={isSmallDevice}
          />
        </View>
        {/* Active Quest Card (from Dashboard) */}
        {activeQuest && (
          <View style={twrnc`px-5 mb-6`}>
            <Animated.View
              style={[twrnc`overflow-hidden rounded-2xl shadow-lg`, { transform: [{ scale: pulseAnim }] }]}
            >
              <View style={twrnc`bg-[#2A2E3A] p-4 rounded-2xl border border-[#4361EE]`}>
                <View style={twrnc`flex-row items-center mb-3`}>
                  <View style={twrnc`bg-[#4361EE] rounded-full p-2 mr-3`}>
                    <Ionicons name="trophy" size={20} color="#FFFFFF" />
                  </View>
                  <View style={twrnc`flex-1`}>
                    <CustomText weight="bold" style={twrnc`text-white text-lg mb-1`}>
                      {activeQuest.title}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-sm`}>{activeQuest.description}</CustomText>
                  </View>
                  <View style={twrnc`bg-[#FFC107] px-3 py-1 rounded-full`}>
                    <CustomText style={twrnc`text-[#121826] text-xs font-bold`}>
                      +{activeQuest.xpReward || 50} XP
                    </CustomText>
                  </View>
                </View>
                <View style={twrnc`mt-3`}>
                  <View style={twrnc`flex-row justify-between items-center mb-2`}>
                    <CustomText style={twrnc`text-gray-400 text-sm`}>Progress</CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-sm`}>
                      {Math.round(getDisplayQuestProgress(activeQuest) * 100)}%
                    </CustomText>
                  </View>
                  <View style={twrnc`h-3 bg-[#3A3F4B] rounded-full overflow-hidden`}>
                    <View
                      style={[
                        twrnc`h-3 rounded-full`,
                        {
                          width: `${getDisplayQuestProgress(activeQuest) * 100}%`,
                          backgroundColor: getQuestStatus(activeQuest) === "completed" ? "#06D6A0" : "#FFC107",
                        },
                      ]}
                    />
                  </View>
                  <View style={twrnc`flex-row justify-between items-center mt-2`}>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>
                      Current:{" "}
                      {activeQuest.unit === "steps"
                        ? `${getCurrentQuestValue(activeQuest).toLocaleString()} steps`
                        : activeQuest.unit === "reps"
                          ? `${getCurrentQuestValue(activeQuest)} reps`
                          : activeQuest.unit === "duration"
                            ? `${getCurrentQuestValue(activeQuest)} min`
                            : `${getCurrentQuestValue(activeQuest).toFixed(2)} km`}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>
                      Goal:{" "}
                      {activeQuest.unit === "steps"
                        ? `${activeQuest.goal.toLocaleString()} steps`
                        : activeQuest.unit === "reps"
                          ? `${activeQuest.goal} reps`
                          : activeQuest.unit === "duration"
                            ? `${activeQuest.goal} min`
                            : `${activeQuest.goal} km`}
                    </CustomText>
                  </View>
                </View>
                {getQuestStatus(activeQuest) === "completed" && (
                  <View style={twrnc`mt-4 bg-[#06D6A0] bg-opacity-20 rounded-xl p-3 flex-row items-center`}>
                    <Ionicons name="checkmark-circle" size={20} color="#06D6A0" style={twrnc`mr-2`} />
                    <CustomText weight="bold" style={twrnc`text-[#06D6A0] text-sm`}>
                      Quest Completed! Great job!
                    </CustomText>
                  </View>
                )}
              </View>
            </Animated.View>
          </View>
        )}
        {/* Activity Selection */}
        {!showSettings && (
          <View style={twrnc`px-5 mb-6`}>
            <View style={twrnc`flex-row items-center mb-4`}>
              <Ionicons name="fitness" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                Choose Activity
              </CustomText>
            </View>
            <View style={twrnc`flex-row flex-wrap justify-between`}>
              {activities.map((activity) => (
                <TouchableOpacity
                  key={activity.id}
                  style={[
                    twrnc`rounded-2xl p-4 items-center mb-4 shadow-md`,
                    {
                      backgroundColor: selectedActivity === activity.id ? activity.color : "#2A2E3A",
                      width: width < 350 ? "100%" : "48%",
                      borderWidth: selectedActivity === activity.id ? 2 : 0,
                      borderColor: selectedActivity === activity.id ? "#FFFFFF" : "transparent",
                    },
                  ]}
                  onPress={() => {
                    console.log("ActivityScreen: Activity selected:", activity.id)
                    if (sensorSubscription) {
                      stopAccelerometerTracking()
                    }
                    setSelectedActivity(activity.id)
                  }}
                >
                  <Image
                    source={activity.icon}
                    resizeMode="contain"
                    style={[
                      twrnc`w-10 h-10 mb-2`,
                      { tintColor: selectedActivity === activity.id ? activity.iconColor : "#FFFFFF" },
                    ]}
                  />
                  <CustomText
                    weight="medium"
                    style={{ color: selectedActivity === activity.id ? activity.iconColor : "#FFFFFF" }}
                  >
                    {activity.name}
                  </CustomText>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {/* Settings Section */}
        {showSettings && (
          <View style={twrnc`px-5 mb-6`}>
            <View style={twrnc`flex-row items-center mb-4`}>
              <Ionicons name="options-outline" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                Activity Settings
              </CustomText>
            </View>
            <View style={twrnc`bg-[#2A2E3A] rounded-2xl mb-4 shadow-sm overflow-hidden`}>
              {isStrengthActivity ? (
                <>
                  <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                    <View style={twrnc`flex-row justify-between items-center`}>
                      <View style={twrnc`flex-row items-center`}>
                        <Ionicons name="fitness-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                        <CustomText weight="medium" style={twrnc`text-white`}>
                          Rep Goal
                        </CustomText>
                      </View>
                      <View style={twrnc`flex-row items-center`}>
                        <TextInput
                          style={twrnc`text-white text-base bg-[#3A3F4B] rounded-l px-3 py-2 w-16 text-right`}
                          value={repGoal.toString()}
                          onChangeText={handleRepGoalChange}
                          keyboardType="numeric"
                          placeholder="20"
                          placeholderTextColor="#888"
                        />
                        <View style={twrnc`bg-[#3A3F4B] rounded-r px-2 py-2`}>
                          <CustomText style={twrnc`text-gray-400`}>reps</CustomText>
                        </View>
                      </View>
                    </View>
                    <CustomText style={twrnc`text-gray-400 text-xs mt-2 ml-8`}>
                      Set a target number of repetitions
                    </CustomText>
                  </View>
                </>
              ) : (
                <>
                  <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                    <View style={twrnc`flex-row justify-between items-center`}>
                      <View style={twrnc`flex-row items-center`}>
                        <Ionicons name="map-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                        <CustomText weight="medium" style={twrnc`text-white`}>
                          Target Distance
                        </CustomText>
                      </View>
                      <View style={twrnc`flex-row items-center`}>
                        <TextInput
                          style={twrnc`text-white text-base bg-[#3A3F4B] rounded-l px-3 py-2 w-16 text-right`}
                          value={distance}
                          onChangeText={handleDistanceChange}
                          keyboardType="numeric"
                          placeholder="0.00"
                          placeholderTextColor="#888"
                        />
                        <View style={twrnc`bg-[#3A3F4B] rounded-r px-2 py-2`}>
                          <CustomText style={twrnc`text-gray-400`}>km</CustomText>
                        </View>
                      </View>
                    </View>
                  </View>
                  <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                    <View style={twrnc`flex-row justify-between items-center mb-3`}>
                      <View style={twrnc`flex-row items-center`}>
                        <Ionicons name="time-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                        <CustomText weight="medium" style={twrnc`text-white`}>
                          Target Duration
                        </CustomText>
                      </View>
                    </View>
                    <View style={twrnc`flex-row flex-wrap justify-between ml-8`}>
                      {[10, 20, 30, 45, 60, 90].map((mins) => (
                        <TouchableOpacity
                          key={mins}
                          style={[
                            twrnc`w-[30%] mb-3 py-2 rounded-lg items-center`,
                            time === mins.toString()
                              ? { backgroundColor: currentActivity.color }
                              : { backgroundColor: "#3A3F4B" },
                          ]}
                          onPress={() => setTime(mins.toString())}
                        >
                          <CustomText style={twrnc`text-white`}>{mins} min</CustomText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                    <View style={twrnc`flex-row justify-between items-center`}>
                      <View style={twrnc`flex-row items-center`}>
                        <Ionicons name="location-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                        <View>
                          <CustomText weight="medium" style={twrnc`text-white`}>
                            GPS Tracking
                          </CustomText>
                          <CustomText style={twrnc`text-gray-400 text-xs mt-1`}>
                            Required for accurate tracking
                          </CustomText>
                        </View>
                      </View>
                      <Switch
                        trackColor={{ false: "#3A3F4B", true: "#4361EE" }}
                        thumbColor="#FFFFFF"
                        ios_backgroundColor="#3A3F4B"
                        onValueChange={setGpsEnabled}
                        value={gpsEnabled}
                      />
                    </View>
                  </View>
                </>
              )}
              <View style={twrnc`p-4`}>
                <View style={twrnc`flex-row justify-between items-center`}>
                  <View style={twrnc`flex-row items-center`}>
                    <Ionicons name="flame-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                    <CustomText weight="medium" style={twrnc`text-white`}>
                      Estimated Calories
                    </CustomText>
                  </View>
                  <View style={twrnc`bg-[#FFC107] rounded px-3 py-1`}>
                    <CustomText weight="semibold" style={twrnc`text-[#121826]`}>
                      {calories} kcal
                    </CustomText>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}
        {/* Current Progress */}
        {(coordinates.length > 0 || (isStrengthActivity && stats.reps > 0)) && (
          <View style={twrnc`px-5 mb-6`}>
            <View style={twrnc`flex-row items-center mb-4`}>
              <Ionicons name="stats-chart" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                Current Progress
              </CustomText>
            </View>
            <View style={twrnc`bg-[#2A2E3A] rounded-2xl p-4 shadow-md`}>
              {isStrengthActivity ? (
                <View style={twrnc`flex-row justify-between mb-4`}>
                  <View style={twrnc`items-center flex-1`}>
                    <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Reps</CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                      {stats.reps || 0}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>completed</CustomText>
                  </View>
                  <View style={twrnc`items-center flex-1 border-l border-r border-[#3A3F4B] px-2`}>
                    <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Duration</CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                      {formatDuration(stats.duration || 0)}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>time</CustomText>
                  </View>
                  <View style={twrnc`items-center flex-1`}>
                    <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Calories</CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                      {calories}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>kcal</CustomText>
                  </View>
                </View>
              ) : (
                <View style={twrnc`flex-row justify-between mb-4`}>
                  <View style={twrnc`items-center flex-1`}>
                    <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Distance</CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                      {(stats.distance / 1000).toFixed(2)}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>km</CustomText>
                  </View>
                  <View style={twrnc`items-center flex-1 border-l border-r border-[#3A3F4B] px-2`}>
                    <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Duration</CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                      {formatDuration(stats.duration || 0)}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>time</CustomText>
                  </View>
                  <View style={twrnc`items-center flex-1`}>
                    <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>
                      {selectedActivity === "cycling" ? "Speed" : "Steps"}
                    </CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                      {selectedActivity === "cycling" ? stats.avgSpeed.toFixed(1) : stats.steps.toLocaleString()}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>
                      {selectedActivity === "cycling" ? "km/h" : "steps"}
                    </CustomText>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}
        {/* Tips Section */}
        <View style={twrnc`px-5 mb-10`}>
          <View style={twrnc`flex-row items-center mb-4`}>
            <Ionicons name="bulb-outline" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
            <CustomText weight="bold" style={twrnc`text-white text-lg`}>
              Tips
            </CustomText>
          </View>
          <View style={twrnc`bg-[#2A2E3A] rounded-2xl p-4 shadow-md`}>
            {isStrengthActivity ? (
              <>
                <View style={twrnc`flex-row items-start mb-3`}>
                  <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                  <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                    Keep your phone in your pocket or hold it while exercising for better motion detection
                  </CustomText>
                </View>
                <View style={twrnc`flex-row items-start mb-3`}>
                  <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                  <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                    You can tap the + button to manually count reps if automatic detection isn't working
                  </CustomText>
                </View>
                <View style={twrnc`flex-row items-start`}>
                  <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                  <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                    Complete your quest goals to earn XP and track your fitness progress
                  </CustomText>
                </View>
              </>
            ) : (
              <>
                <View style={twrnc`flex-row items-start mb-3`}>
                  <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                  <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                    Keep your phone in an accessible position for better GPS accuracy
                  </CustomText>
                </View>
                <View style={twrnc`flex-row items-start mb-3`}>
                  <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                  <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                    You can set optional goals or just start tracking without any targets
                  </CustomText>
                </View>
                <View style={twrnc`flex-row items-start`}>
                  <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                  <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                    Complete quests from the Dashboard to earn XP and track your fitness journey
                  </CustomText>
                </View>
              </>
            )}
          </View>
        </View>
      </ScrollView>
      {/* Floating Action Button for small devices */}
      {!coordinates.length > 0 && !sensorSubscription && isSmallDevice && (
        <View style={twrnc`absolute bottom-6 right-6`}>
          <TouchableOpacity
            style={[
              twrnc`w-16 h-16 rounded-full items-center justify-center shadow-lg`,
              { backgroundColor: currentActivity.color, shadowColor: currentActivity.color },
              isTrackingLoading && twrnc`opacity-60`,
            ]}
            onPress={startActivity}
            disabled={isTrackingLoading}
          >
            <Ionicons name="play" size={30} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}
export default ActivityScreen
