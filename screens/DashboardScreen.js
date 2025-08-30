"use client"
import { useState, useEffect, useCallback, useMemo } from "react"
import {
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Dimensions,
  StyleSheet,
  Pressable,
} from "react-native"
import MapView, { Polyline, PROVIDER_GOOGLE } from "react-native-maps"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import { Ionicons } from "@expo/vector-icons"
import * as Location from "expo-location"
import { getDocs, collection, query, where } from "firebase/firestore"
import { db, auth } from "../firebaseConfig"
import { formatTime } from "../utils/activityUtils"

// Badge System Imports - Keep imports, but remove usage on dashboard
import { getUserQuestHistory, completeQuest } from "./BadgeSystem"
import { BadgeModal, BadgeNotification, AllBadgesModal } from "../components/BadgeComponents"

const { width } = Dimensions.get("window")

// Helper functions moved outside component for better performance
const formatDate = (date = new Date()) => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]
  const dayName = days[date.getDay()]
  const day = date.getDate()
  const month = months[date.getMonth()]
  return `${dayName}, ${day} ${month}`
}

const calculateMapRegion = (coordinates) => {
  if (!coordinates || coordinates.length === 0) {
    return {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    }
  }
  const latitudes = coordinates.map((coord) => coord.latitude)
  const longitudes = coordinates.map((coord) => coord.longitude)

  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLon = Math.min(...longitudes)
  const maxLon = Math.max(...longitudes)

  const latitude = (minLat + maxLat) / 2
  const longitude = (minLon + maxLon) / 2

  const latitudeDelta = (maxLat - minLat) * 1.5 || 0.005
  const longitudeDelta = (maxLon - minLon) * 1.5 || 0.005

  return { latitude, longitude, latitudeDelta, longitudeDelta }
}

const getWeekDates = () => {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - dayOfWeek)

  const weekDates = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    weekDates.push({
      day: date.getDate(),
      isToday: date.toDateString() === today.toDateString(),
      date: date,
    })
  }
  return weekDates
}

// Enhanced function to get month calendar data
const getMonthCalendar = (year, month) => {
  const today = new Date()
  const firstDayOfMonth = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const firstDayWeekday = firstDayOfMonth.getDay() // 0 = Sunday, 6 = Saturday

  const calendarDays = []

  // Add empty slots for days before the 1st of the month
  for (let i = 0; i < firstDayWeekday; i++) {
    calendarDays.push({ day: null, isCurrentMonth: false, date: null })
  }

  // Add days of the current month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    calendarDays.push({
      day: day,
      isToday: date.toDateString() === today.toDateString(),
      isCurrentMonth: true,
      date: date,
    })
  }

  // Fill remaining slots in the grid (if needed)
  const remainingSlots = 42 - calendarDays.length // 6 rows x 7 columns = 42
  if (remainingSlots > 0 && remainingSlots < 7) {
    for (let i = 1; i <= remainingSlots; i++) {
      calendarDays.push({ day: i, isCurrentMonth: false, date: new Date(year, month + 1, i) })
    }
  }
  return calendarDays
}

// Get month name and year for display
const getMonthYearString = (date) => {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]
  return `${months[date.getMonth()]} ${date.getFullYear()}`
}

// Enhanced Dynamic Quest Generator with distance-based quests
const generateDynamicQuests = (userStats, userLevel = 1, preferences = {}) => {
  const baseQuests = [
    {
      id: "daily_distance",
      type: "daily",
      title: "Daily Distance Challenge",
      description: "Reach your daily distance goal",
      unit: "distance",
      goal: Math.max(2, userStats.avgDailyDistance * 1.1), // 10% more than average in km
      difficulty: "easy",
      xpReward: 50,
      category: "fitness",
      activityType: "walking",
    },
    {
      id: "distance_goal",
      type: "daily",
      title: "Distance Explorer",
      description: "Cover your target distance today",
      unit: "distance",
      goal: Math.max(3, userStats.avgDailyDistance * 1.2), // 20% more than average in km
      difficulty: "medium",
      xpReward: 75,
      category: "endurance",
      activityType: "running",
    },
    {
      id: "active_minutes",
      type: "daily",
      title: "Stay Active",
      description: "Maintain activity for the target duration",
      unit: "duration",
      goal: Math.max(30, userStats.avgActiveDuration * 1.15), // 15% more than average
      difficulty: "medium",
      xpReward: 60,
      category: "consistency",
      activityType: "jogging",
    },
    {
      id: "strength_builder",
      type: "daily",
      title: "Strength Builder",
      description: "Complete your strength training reps",
      unit: "reps",
      goal: Math.max(20, userStats.avgDailyReps * 1.3), // 30% more than average
      difficulty: "hard",
      xpReward: 80,
      category: "strength",
      activityType: "pushup",
    },
    {
      id: "cycling_challenge",
      type: "daily",
      title: "Cycling Adventure",
      description: "Complete a cycling session",
      unit: "distance",
      goal: Math.max(5, userStats.avgDailyDistance * 1.5), // 50% more for cycling in km
      difficulty: "medium",
      xpReward: 70,
      category: "endurance",
      activityType: "cycling",
    },
    {
      id: "flexibility_focus",
      type: "daily",
      title: "Flexibility Focus",
      description: "Complete stretching or yoga session",
      unit: "duration",
      goal: Math.max(15, userStats.avgActiveDuration * 0.5), // Shorter duration for flexibility
      difficulty: "easy",
      xpReward: 40,
      category: "flexibility",
      activityType: "yoga",
    },
  ]
  // Add level-based multipliers
  const levelMultiplier = 1 + (userLevel - 1) * 0.1
  return baseQuests.map((quest) => ({
    ...quest,
    goal: Math.round(quest.goal * levelMultiplier * 100) / 100, // Keep 2 decimal places for distance
    xpReward: Math.round(quest.xpReward * levelMultiplier),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
  }))
}

// Enhanced function to get activity display info based on type
const getActivityDisplayInfo = (activity) => {
  const activityType = activity.activityType || "unknown"

  // Distance-based activities
  if (["walking", "running", "jogging", "cycling"].includes(activityType)) {
    return {
      primaryMetric: {
        label: "Distance",
        value: activity.distance ? `${Number.parseFloat(activity.distance).toFixed(2)} km` : "0 km",
        icon: "map-outline",
        color: "#06D6A0",
      },
      secondaryMetric: {
        label: "Duration",
        value: activity.duration
          ? typeof activity.duration === "number"
            ? formatTime(activity.duration)
            : activity.duration
          : "0:00",
        icon: "time-outline",
        color: "#FFC107",
      },
      tertiaryMetric: {
        label: activityType === "cycling" ? "Speed" : "Pace",
        value:
          activityType === "cycling"
            ? activity.avgSpeed
              ? `${Number.parseFloat(activity.avgSpeed).toFixed(1)} km/h`
              : "0 km/h"
            : activity.pace
              ? typeof activity.pace === "number"
                ? formatTime(activity.pace) + "/km"
                : activity.pace
              : "0:00/km",
        icon: "speedometer-outline",
        color: "#4361EE",
      },
    }
  }

  // Strength-based activities
  if (["pushup", "pullup", "squat", "plank", "situp"].includes(activityType)) {
    return {
      primaryMetric: {
        label: activityType === "plank" ? "Duration" : "Reps",
        value:
          activityType === "plank"
            ? activity.duration
              ? typeof activity.duration === "number"
                ? formatTime(activity.duration)
                : activity.duration
              : "0:00"
            : activity.reps
              ? activity.reps.toString()
              : "0",
        icon: activityType === "plank" ? "time-outline" : "fitness-outline",
        color: "#EF476F",
      },
      secondaryMetric: {
        label: "Sets",
        value: activity.sets ? activity.sets.toString() : "1",
        icon: "repeat-outline",
        color: "#FFC107",
      },
      tertiaryMetric: {
        label: "Total Time",
        value: activity.duration
          ? typeof activity.duration === "number"
            ? formatTime(activity.duration)
            : activity.duration
          : "0:00",
        icon: "stopwatch-outline",
        color: "#4361EE",
      },
    }
  }

  // Flexibility/Yoga activities
  if (["yoga", "stretching", "meditation"].includes(activityType)) {
    return {
      primaryMetric: {
        label: "Duration",
        value: activity.duration
          ? typeof activity.duration === "number"
            ? formatTime(activity.duration)
            : activity.duration
          : "0:00",
        icon: "time-outline",
        color: "#06D6A0",
      },
      secondaryMetric: {
        label: "Poses/Stretches",
        value: activity.poses || activity.stretches || activity.exercises || "0",
        icon: "body-outline",
        color: "#FFC107",
      },
      tertiaryMetric: {
        label: "Intensity",
        value: activity.intensity || "Moderate",
        icon: "pulse-outline",
        color: "#4361EE",
      },
    }
  }

  // Default fallback for unknown activity types
  return {
    primaryMetric: {
      label: "Duration",
      value: activity.duration
        ? typeof activity.duration === "number"
          ? formatTime(activity.duration)
          : activity.duration
        : "0:00",
      icon: "time-outline",
      color: "#06D6A0",
    },
    secondaryMetric: {
      label: "Type",
      value: activityType.charAt(0).toUpperCase() + activityType.slice(1),
      icon: "fitness-outline",
      color: "#FFC107",
    },
    tertiaryMetric: {
      label: "Completed",
      value: "✓",
      icon: "checkmark-circle-outline",
      color: "#4361EE",
    },
  }
}

const DashboardScreen = ({ navigateToActivity, navigation }) => {

  // Get responsive dimensions
  const { width, height } = Dimensions.get("window");
  const isSmallDevice = width < 375; // iPhone SE and similar small Android devices
  const isMediumDevice = width >= 375 && width < 414; // Standard phones
  const isLargeDevice = width >= 414; // Large phones

  // Responsive font sizes
  const responsiveFontSizes = {
    xs: isSmallDevice ? 10 : isMediumDevice ? 11 : 12,
    sm: isSmallDevice ? 12 : isMediumDevice ? 13 : 14,
    base: isSmallDevice ? 14 : isMediumDevice ? 15 : 16,
    lg: isSmallDevice ? 16 : isMediumDevice ? 18 : 20,
    xl: isSmallDevice ? 18 : isMediumDevice ? 20 : 22,
    "2xl": isSmallDevice ? 20 : isMediumDevice ? 22 : 24,
  };

  // Responsive padding/margin
  const responsivePadding = {
    base: isSmallDevice ? 3 : isMediumDevice ? 4 : 5,
    lg: isSmallDevice ? 4 : isMediumDevice ? 5 : 6,
  };

  const [activityData, setActivityData] = useState({
    coordinates: [],
    distance: "0 km",
    duration: "0:00",
    steps: 0,
    activityType: "walking",
    stats: { pace: "0:00/km", avgSpeed: "0 km/h" },
  })
  const [userLocation, setUserLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Dynamic Quest States
  const [dynamicQuests, setDynamicQuests] = useState([])
  const [userStats, setUserStats] = useState({
    avgDailySteps: 5000,
    avgDailyDistance: 2.5, // in kilometers
    avgActiveDuration: 45,
    avgDailyReps: 20, // Added for strength quests
    level: 1,
    totalXP: 0,
  })
  const [questLoading, setQuestLoading] = useState(true)
  const [weeklyProgress, setWeeklyProgress] = useState([])
  const [monthlyProgress, setMonthlyProgress] = useState([])
  const [isQuestModalVisible, setIsQuestModalVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [isDateActivitiesModalVisible, setIsDateActivitiesModalVisible] = useState(false)
  const [dateActivities, setDateActivities] = useState([])


  const [questHistory, setQuestHistory] = useState([])
  // const [isAllBadgesModalVisible, setIsAllBadgesModalVisible] = useState(false)

  // Time period dropdown state - KEPT FOR DATA AGGREGATION
  const [timePeriod, setTimePeriod] = useState("week") // 'week' or 'month'
  const [isTimeDropdownVisible, setIsTimeDropdownVisible] = useState(false)

  // New state for activity details modal
  const [isActivityModalVisible, setIsActivityModalVisible] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState(null)

  // Calendar State for month navigation
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date()) // For month navigation
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date()) // For highlighting selected day

  const weekDates = useMemo(() => getWeekDates(), [])
  const monthCalendar = useMemo(
    () => getMonthCalendar(currentMonthDate.getFullYear(), currentMonthDate.getMonth()),
    [currentMonthDate],
  )

  useEffect(() => {
    const getUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== "granted") {
          setError("Permission to access location was denied")
          console.warn("Location permission denied")
          return
        }
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000,
          distanceInterval: 10,
        })
        setUserLocation(location.coords)
      } catch (err) {
        console.error("Location error:", err.message)
        setError("Failed to get location. Please ensure location services are enabled.")
      }
    }
    getUserLocation()
  }, [])

  // Enhanced Calculate user statistics from historical data
  const calculateUserStats = (activitiesData) => {
    if (activitiesData.length === 0) {
      return {
        avgDailySteps: 5000,
        avgDailyDistance: 2.5, // in kilometers
        avgActiveDuration: 45,
        avgDailyReps: 20, // Default for strength activities
        level: 1,
        totalXP: 0,
      }
    }

    const totalSteps = activitiesData.reduce((sum, act) => sum + (act.steps || 0), 0)
    const totalDistance = activitiesData.reduce((sum, act) => sum + (act.distance || 0), 0) // in kilometers
    const totalDuration = activitiesData.reduce((sum, act) => sum + (act.duration || 0), 0)
    const totalReps = activitiesData.reduce((sum, act) => sum + (act.reps || 0), 0) // Added reps calculation

    // Get unique days to calculate daily averages
    const uniqueDays = new Set(
      activitiesData.map((act) =>
        act.createdAt?.toDate ? act.createdAt.toDate().toDateString() : new Date().toDateString(),
      ),
    ).size

    const avgDailySteps = Math.round(totalSteps / Math.max(uniqueDays, 1))
    const avgDailyDistance = Number((totalDistance / Math.max(uniqueDays, 1)).toFixed(2)) // in kilometers
    const avgActiveDuration = Math.round(totalDuration / Math.max(activitiesData.length, 1))
    const avgDailyReps = Math.round(totalReps / Math.max(uniqueDays, 1)) // Added reps average

    // Calculate level based on total activities and performance
    const level = Math.max(1, Math.floor(activitiesData.length / 10) + 1)
    const totalXP = activitiesData.length * 25 + Math.floor(totalDistance * 10) + Math.floor(totalReps / 10) * 3

    return {
      avgDailySteps,
      avgDailyDistance,
      avgActiveDuration,
      avgDailyReps, // Added to return object
      level,
      totalXP,
    }
  }

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const user = auth.currentUser
      if (!user) {
        setError("Please sign in to view activities")
        setLoading(false)
        return
      }

      // Determine date range based on selected time period
      let startDate, endDate
      if (timePeriod === "week") {
        const weekDates = getWeekDates()
        startDate = new Date(weekDates[0].date)
        startDate.setHours(0, 0, 0, 0)
        endDate = new Date(weekDates[6].date)
        endDate.setHours(23, 59, 59, 999)
      } else {
        // month
        const year = currentMonthDate.getFullYear()
        const month = currentMonthDate.getMonth()
        startDate = new Date(year, month, 1)
        startDate.setHours(0, 0, 0, 0)
        endDate = new Date(year, month + 1, 0)
        endDate.setHours(23, 59, 59, 999)
      }

      const activitiesRef = collection(db, "activities")
      const activitiesQuery = query(
        activitiesRef,
        where("userId", "==", user.uid),
        where("createdAt", ">=", startDate),
        where("createdAt", "<=", endDate),
      )
      const activitiesSnapshot = await getDocs(activitiesQuery)
      const activitiesData = activitiesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      if (activitiesData.length > 0) {
        const latestActivity = activitiesData.sort(
          (a, b) => (b.createdAt?.toDate() || new Date()) - (a.createdAt?.toDate() || new Date()),
        )[0]
        const formattedDistance = latestActivity.distance
          ? `${Number.parseFloat(latestActivity.distance).toFixed(2)} km`
          : "0 km"
        const formattedDuration = latestActivity.duration ? formatTime(latestActivity.duration) : "0:00"
        const formattedPace = latestActivity.pace ? formatTime(latestActivity.pace) + "/km" : "0:00/km"

        setActivityData({
          coordinates: latestActivity.coordinates || [],
          distance: formattedDistance,
          duration: formattedDuration,
          steps: latestActivity.steps || 0,
          activityType: latestActivity.activityType || "walking",
          stats: {
            pace: formattedPace,
            avgSpeed: latestActivity.avgSpeed ? `${latestActivity.avgSpeed.toFixed(1)} km/h` : "0 km/h",
          },
        })
      }

      // Calculate user statistics and generate dynamic quests
      const calculatedStats = calculateUserStats(activitiesData)
      setUserStats(calculatedStats)

      // Generate dynamic quests based on user performance
      const generatedQuests = generateDynamicQuests(calculatedStats, calculatedStats.level)
      setDynamicQuests(generatedQuests)

      // Load quest history and check badges
      const userQuestHistory = await getUserQuestHistory(user.uid)
      setQuestHistory(userQuestHistory)

      // Check and award badges - REMOVED FROM DASHBOARD DISPLAY
      // await checkAndAwardBadges(activitiesData, userQuestHistory)

      // Get today's main quest (first one for now)
      const todayQuest = generatedQuests[0]
      if (todayQuest) {
        // Process weekly progress - now handles all activity types
        const weekProgress = weekDates.map(({ date }) => {
          const startOfDay = new Date(date)
          startOfDay.setHours(0, 0, 0, 0)
          const endOfDay = new Date(date)
          endOfDay.setHours(23, 59, 59, 999)

          const dayActivities = activitiesData.filter((act) => {
            const actDate = act.createdAt?.toDate()
            return actDate >= startOfDay && actDate <= endOfDay
          })

          let totalValue = 0
          if (todayQuest.unit === "steps") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.steps || 0), 0)
          } else if (todayQuest.unit === "distance") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.distance || 0), 0) // in kilometers
          } else if (todayQuest.unit === "duration") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.duration || 0), 0)
          } else if (todayQuest.unit === "reps") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.reps || 0), 0)
          }

          const progress = Math.min(totalValue / todayQuest.goal, 1)
          return { date, progress, completed: progress >= 1, activities: dayActivities }
        })
        setWeeklyProgress(weekProgress)

        // Process monthly progress - now handles all activity types
        const monthProgress = monthCalendar.map(({ date, isCurrentMonth }) => {
          if (!date || !isCurrentMonth) return { date, progress: 0, completed: false, activities: [] }

          const startOfDay = new Date(date)
          startOfDay.setHours(0, 0, 0, 0)
          const endOfDay = new Date(date)
          endOfDay.setHours(23, 59, 59, 999)

          const dayActivities = activitiesData.filter((act) => {
            const actDate = act.createdAt?.toDate()
            return actDate >= startOfDay && actDate <= endOfDay
          })

          let totalValue = 0
          if (todayQuest.unit === "steps") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.steps || 0), 0)
          } else if (todayQuest.unit === "distance") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.distance || 0), 0) // in kilometers
          } else if (todayQuest.unit === "duration") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.duration || 0), 0)
          } else if (todayQuest.unit === "reps") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.reps || 0), 0)
          }

          const progress = Math.min(totalValue / todayQuest.goal, 1)
          return { date, progress, completed: progress >= 1, activities: dayActivities }
        })
        setMonthlyProgress(monthProgress)
      }

      setLoading(false)
      setQuestLoading(false)
      setRefreshing(false)
    } catch (err) {
      console.error("Error fetching data:", err)
      setError(err.message)
      setLoading(false)
      setQuestLoading(false)
      setRefreshing(false)
    }
  }, [timePeriod, weekDates, monthCalendar, currentMonthDate]) // Removed badge-related dependencies

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    fetchData()
  }, [fetchData])

  const calculateQuestProgress = (quest) => {
    if (!quest || !activityData) return 0

    let currentValue = 0
    if (quest.unit === "steps") {
      currentValue = activityData.steps
    } else if (quest.unit === "distance") {
      // Parse distance from string "X km" to number
      currentValue = Number.parseFloat(activityData.distance) || 0
    } else if (quest.unit === "duration") {
      // Convert duration string to minutes
      const durationParts = activityData.duration.split(":")
      currentValue = Number.parseInt(durationParts[0]) * 60 + Number.parseInt(durationParts[1])
    } else if (quest.unit === "reps") {
      // For reps, we need to get today's total reps from activities
      currentValue = 0 // This will be calculated from today's activities
    }
    return Math.min(currentValue / quest.goal, 1)
  }

  const getQuestStatus = (quest) => {
    const progress = calculateQuestProgress(quest)
    if (progress >= 1) return "completed"
    if (progress > 0) return "in_progress"
    return "not_started"
  }

  const getCurrentQuestValue = (quest) => {
    if (!quest) return 0

    if (quest.unit === "steps") {
      return Math.min(activityData.steps, quest.goal)
    } else if (quest.unit === "distance") {
      // Parse distance from string "X km" to number
      const currentDistance = Number.parseFloat(activityData.distance) || 0
      return Math.min(currentDistance, quest.goal)
    } else if (quest.unit === "duration") {
      const durationParts = activityData.duration.split(":")
      const currentMinutes = Number.parseInt(durationParts[0]) * 60 + Number.parseInt(durationParts[1])
      return Math.min(currentMinutes, quest.goal)
    } else if (quest.unit === "reps") {
      return 0 // This will be updated from today's activities
    }
    return 0
  }

  // Enhanced Navigate to activity screen with quest details and badge checking
  const navigateToQuestActivity = async (quest) => {
    try {
      setIsQuestModalVisible(false) // Close the modal if open
      // Navigate to activity with quest details
      navigateToActivity({
        questId: quest.id,
        title: quest.title,
        description: quest.description,
        goal: quest.goal,
        unit: quest.unit,
        progress: calculateQuestProgress(quest),
        status: getQuestStatus(quest),
        activityType: quest.activityType,
        xpReward: quest.xpReward,
        difficulty: quest.difficulty,
        category: quest.category,
        onQuestComplete: async (activityData) => {
          // This callback will be called when quest is completed
          try {
            await completeQuest(quest.id, quest, activityData)
            // Refresh data to check for new badges (if badge system is re-enabled elsewhere)
            await fetchData()
          } catch (error) {
            console.error("Error completing quest:", error)
          }
        },
      })
    } catch (error) {
      console.error("Error starting quest:", error)
    }
  }

  // Simplified function to view activity details in modal (no flyover animation)
  const viewActivityDetails = (activity) => {
    setSelectedActivity(activity)
    setIsActivityModalVisible(true)
  }

  // Function to resume activity from modal
  const resumeActivity = () => {
    setIsActivityModalVisible(false)
    if (selectedActivity) {
      navigateToActivity({
        activityType: selectedActivity.activityType,
        coordinates: selectedActivity.coordinates,
        stats: {
          distance: Number.parseFloat(selectedActivity.distance) * 1000, // Convert km to meters
          duration: selectedActivity.duration
            .split(":")
            .reduce((acc, time, index) => acc + Number.parseInt(time) * (index === 0 ? 60 : 1), 0),
          pace: selectedActivity.stats.pace
            .replace("/km", "")
            .split(":")
            .reduce((acc, time, index) => acc + Number.parseInt(time) * (index === 0 ? 60 : 1), 0),
          avgSpeed: Number.parseFloat(selectedActivity.stats.avgSpeed),
          steps: selectedActivity.steps,
        },
      })
    }
  }

  // Function to clear activity from modal
  const clearActivity = () => {
    setIsActivityModalVisible(false)
    // You can add confirmation dialog here if needed
    if (selectedActivity) {
      // Clear the activity data
      // This would typically involve a call to your backend or state management
      // For now, we'll just close the modal
    }
  }

  // Toggle time period dropdown
  const toggleTimeDropdown = () => {
    setIsTimeDropdownVisible(!isTimeDropdownVisible)
  }

  // Select time period and close dropdown
  const selectTimePeriod = (period) => {
    setTimePeriod(period)
    setIsTimeDropdownVisible(false)
  }

  // Function to render a day cell in the month calendar
  const renderCalendarDay = (dayInfo, index) => {
    if (!dayInfo.isCurrentMonth) {
      return (
        <View key={index} style={twrnc`w-[14.28%] aspect-square items-center justify-center opacity-30`}>
          {dayInfo.day && <CustomText style={twrnc`text-gray-500 text-xs`}>{dayInfo.day}</CustomText>}
        </View>
      )
    }
    // Find progress data for this day
    const progressData = monthlyProgress.find(
      (p) => p.date && p.date.toDateString() === dayInfo.date.toDateString(),
    ) || { progress: 0, completed: false, activities: [] }
    const isCompleted = progressData.completed
    const progress = progressData.progress
    const isToday = dayInfo.isToday
    const hasActivities = progressData.activities && progressData.activities.length > 0
    return (
      <TouchableOpacity
        key={index}
        style={twrnc`w-[14.28%] aspect-square items-center justify-center p-1`}
        activeOpacity={0.7}
        onPress={() => dayInfo.date && handleDaySelection(dayInfo.date)}
      >
        <View
          style={twrnc`w-full h-full rounded-2xl items-center justify-center
          ${isCompleted ? "bg-[#06D6A0]" : hasActivities ? "bg-[#FFC107]" : progress > 0 ? "bg-[#4361EE]" : "bg-[#2A2E3A]"}
          ${isToday ? "border-2 border-[#4361EE]" : ""}`}
        >
          {isCompleted ? (
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
          ) : hasActivities ? (
            <View style={twrnc`items-center`}>
              <CustomText weight={isToday ? "bold" : "medium"} style={twrnc`text-white text-xs`}>
                {dayInfo.day}
              </CustomText>
              <View style={twrnc`w-1 h-1 bg-white rounded-full mt-1`} />
            </View>
          ) : progress > 0 ? (
            <View style={twrnc`items-center`}>
              <CustomText weight={isToday ? "bold" : "medium"} style={twrnc`text-white text-xs`}>
                {dayInfo.day}
              </CustomText>
              <CustomText style={twrnc`text-white text-[10px]`}>{Math.round(progress * 100)}%</CustomText>
            </View>
          ) : (
            <CustomText weight={isToday ? "bold" : "medium"} style={twrnc`text-white text-sm`}>
              {dayInfo.day}
            </CustomText>
          )}
        </View>
      </TouchableOpacity>
    )
  }

  // Function to handle day selection from the calendar
  const handleDaySelection = async (date) => {
    try {
      setSelectedCalendarDate(date) // Update selected date for highlighting
      setLoading(true)
      const user = auth.currentUser
      if (!user) {
        setError("Please sign in to view activities")
        setLoading(false)
        return
      }

      // Set start and end of the selected day
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      // Query activities for the selected day
      const activitiesRef = collection(db, "activities")
      const activitiesQuery = query(
        activitiesRef,
        where("userId", "==", user.uid),
        where("createdAt", ">=", startOfDay),
        where("createdAt", "<=", endOfDay),
      )
      const activitiesSnapshot = await getDocs(activitiesQuery)
      const activitiesData = activitiesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        // Enhanced formatting for all activity types
        displayInfo: getActivityDisplayInfo(doc.data()),
        formattedTime: doc.data().createdAt?.toDate
          ? doc.data().createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "",
      }))

      if (activitiesData.length > 0) {
        // Sort activities by time (newest first)
        activitiesData.sort((a, b) => (b.createdAt?.toDate() || new Date()) - (a.createdAt?.toDate() || new Date()))
        setDateActivities(activitiesData)
      } else {
        setDateActivities([])
      }

      setIsDateActivitiesModalVisible(true)
      setLoading(false)
    } catch (err) {
      console.error("Error fetching day activities:", err)
      setError(err.message)
      setLoading(false)
    }
  }

  // Function to navigate month in calendar
  const navigateMonth = useCallback((direction) => {
    setCurrentMonthDate((prevDate) => {
      const newDate = new Date(prevDate)
      newDate.setMonth(prevDate.getMonth() + direction)
      return newDate
    })
  }, [])

  if (loading || questLoading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size="large" color="#4361EE" />
        <CustomText style={twrnc`text-white mt-4`}>Loading Dashboard...</CustomText>
      </View>
    )
  }

  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center px-6`}>
        <View style={twrnc`bg-[#2A2E3A] rounded-2xl p-6 items-center w-full max-w-sm`}>
          <View style={twrnc`bg-[#EF476F] bg-opacity-20 rounded-full p-4 mb-4`}>
            <Ionicons name="alert-circle" size={32} color="#EF476F" />
          </View>
          <CustomText weight="bold" style={twrnc`text-white text-lg mb-2 text-center`}>
            Something went wrong
          </CustomText>
          <CustomText style={twrnc`text-gray-400 text-sm text-center mb-6`}>{error}</CustomText>
          <TouchableOpacity style={twrnc`bg-[#4361EE] px-6 py-3 rounded-xl w-full`} onPress={fetchData}>
            <CustomText weight="bold" style={twrnc`text-white text-center`}>
              Try Again
            </CustomText>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // Get today's main quest
  const todayQuest = dynamicQuests[0]

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <ScrollView
        style={twrnc`flex-1`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4361EE"
            colors={["#4361EE", "#FFC107"]}
          />
        }
      >
        <View style={twrnc`px-${responsivePadding.base} mb-6`}>
          {/* Header Section - Made responsive */}
          <View style={twrnc`flex-row justify-between items-center mb-6`}>
            <View style={twrnc`flex-1 mr-2`}>
              <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes["2xl"] }]}>
                Your Progress
              </CustomText>
              <View style={twrnc`flex-row items-center mt-1 flex-wrap`}>
                <View style={twrnc`bg-[#4361EE] rounded-full px-3 py-1 mr-2 mb-1`}>
                  <CustomText style={[twrnc`text-white`, { fontSize: responsiveFontSizes.xs }]}>
                    Level {userStats.level}
                  </CustomText>
                </View>
                <View style={twrnc`bg-[#FFC107] rounded-full px-3 py-1 mb-1`}>
                  <CustomText style={[twrnc`text-[#121826]`, { fontSize: responsiveFontSizes.xs }]}>
                    {userStats.totalXP} XP
                  </CustomText>
                </View>
              </View>
            </View>
            {/* Time Period Dropdown */}
            <View style={twrnc`relative`}>
              <TouchableOpacity
                style={twrnc`flex-row items-center bg-[#2A2E3A] rounded-2xl px-3 py-2`}
                onPress={toggleTimeDropdown}
              >
                <CustomText style={[twrnc`text-white`, { fontSize: responsiveFontSizes.sm }]}>
                  {timePeriod === "week" ? "Week" : "Month"}
                </CustomText>
                <Ionicons name={isTimeDropdownVisible ? "chevron-up" : "chevron-down"} size={16} color="#FFFFFF" />
              </TouchableOpacity>
              {/* Dropdown Menu */}
              {isTimeDropdownVisible && (
                <View
                  style={twrnc`absolute top-12 right-0 bg-[#2A2E3A] rounded-2xl shadow-lg z-10 w-32 overflow-hidden`}
                >
                  <TouchableOpacity
                    style={twrnc`px-4 py-3 ${timePeriod === "week" ? "bg-[#4361EE]" : ""}`}
                    onPress={() => selectTimePeriod("week")}
                  >
                    <CustomText style={twrnc`text-white text-sm`}>Week</CustomText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={twrnc`px-4 py-3 ${timePeriod === "month" ? "bg-[#4361EE]" : ""}`}
                    onPress={() => selectTimePeriod("month")}
                  >
                    <CustomText style={twrnc`text-white text-sm`}>Month</CustomText>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Progress Calendar - Week View - Made responsive */}
          {timePeriod === "week" && (
            <View style={twrnc`flex-row justify-between mb-6`}>
              {weekDates.map((day, index) => {
                const progressData = weeklyProgress[index] || { progress: 0, completed: false, activities: [] }
                const isCompleted = progressData.completed
                const progress = progressData.progress
                const hasActivities = progressData.activities && progressData.activities.length > 0
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      twrnc`items-center justify-center rounded-2xl`,
                      {
                        width: width * 0.12,
                        height: width * 0.12,
                        marginHorizontal: width * 0.005,
                      },
                      isCompleted ? "bg-[#06D6A0]" : hasActivities ? "bg-[#FFC107]" : progress > 0 ? "bg-[#4361EE]" : "bg-[#2A2E3A]",
                      day.isToday ? "border-2 border-[#4361EE]" : "",
                    ]}
                    activeOpacity={0.7}
                    onPress={() => day.date && handleDaySelection(day.date)}
                  >
                    {isCompleted ? (
                      <Ionicons name="checkmark" size={width * 0.05} color="#FFFFFF" />
                    ) : hasActivities ? (
                      <View style={twrnc`items-center`}>
                        <CustomText
                          weight={day.isToday ? "bold" : "medium"}
                          style={[twrnc`text-white`, { fontSize: responsiveFontSizes.xs }]}
                        >
                          {day.day}
                        </CustomText>
                        <View style={twrnc`w-1 h-1 bg-white rounded-full mt-1`} />
                      </View>
                    ) : progress > 0 ? (
                      <CustomText
                        weight={day.isToday ? "bold" : "medium"}
                        style={[twrnc`text-white`, { fontSize: responsiveFontSizes.xs }]}
                      >
                        {Math.round(progress * 100)}%
                      </CustomText>
                    ) : (
                      <CustomText
                        weight={day.isToday ? "bold" : "medium"}
                        style={[twrnc`text-white`, { fontSize: responsiveFontSizes.sm }]}
                      >
                        {day.day}
                      </CustomText>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          )}

          {/* Month Calendar View - Made responsive */}
          {timePeriod === "month" && (
            <View style={twrnc`mb-6`}>
              {/* Month and Year Header with Navigation */}
              <View style={twrnc`flex-row justify-between items-center mb-4`}>
                <TouchableOpacity onPress={() => navigateMonth(-1)} style={twrnc`p-2`}>
                  <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes.lg }]}>
                  {getMonthYearString(currentMonthDate)}
                </CustomText>
                <TouchableOpacity onPress={() => navigateMonth(1)} style={twrnc`p-2`}>
                  <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
              {/* Weekday Headers */}
              <View style={twrnc`flex-row justify-between mb-3`}>
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                  <View key={index} style={twrnc`w-[14.28%] items-center`}>
                    <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.sm }]}>
                      {day}
                    </CustomText>
                  </View>
                ))}
              </View>
              {/* Calendar Grid */}
              <View style={twrnc`flex-row flex-wrap mb-4`}>
                {monthCalendar.map((day, index) => renderCalendarDay(day, index))}
              </View>
              {/* Enhanced Legend */}
              <View style={twrnc`flex-row justify-center flex-wrap`}>
                <View style={twrnc`flex-row items-center mx-2 my-1`}>
                  <View style={twrnc`w-3 h-3 rounded-full bg-[#2A2E3A] mr-2`} />
                  <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                    No Activity
                  </CustomText>
                </View>
                <View style={twrnc`flex-row items-center mx-2 my-1`}>
                  <View style={twrnc`w-3 h-3 rounded-full bg-[#FFC107] mr-2`} />
                  <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                    Activity Done
                  </CustomText>
                </View>
                <View style={twrnc`flex-row items-center mx-2 my-1`}>
                  <View style={twrnc`w-3 h-3 rounded-full bg-[#06D6A0] mr-2`} />
                  <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                    Goal Achieved
                  </CustomText>
                </View>
              </View>
            </View>
          )}

          {/* Stats Cards - Made responsive */}
          <View style={twrnc`bg-[#2A2E3A] rounded-2xl p-5 mb-6`}>
            <View style={twrnc`flex-row justify-between`}>
              <View style={twrnc`items-center flex-1`}>
                <View style={twrnc`bg-[#06D6A0] bg-opacity-20 rounded-2xl p-3 mb-2`}>
                  <Ionicons name="location" size={width * 0.06} color="#06D6A0" />
                </View>
                <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes.lg }]}>
                  {activityData.distance}
                </CustomText>
                <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                  Distance Today
                </CustomText>
              </View>
              <View style={twrnc`items-center flex-1`}>
                <View style={twrnc`bg-[#FFC107] bg-opacity-20 rounded-2xl p-3 mb-2`}>
                  <Ionicons name="time" size={width * 0.06} color="#FFC107" />
                </View>
                <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes.lg }]}>
                  {activityData.duration}
                </CustomText>
                <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                  Active Time
                </CustomText>
              </View>
            </View>
          </View>

          {/* Dynamic Quest Card - Made responsive */}
          {todayQuest && (
            <View style={twrnc`mx-0 bg-[#2A2E3A] rounded-2xl p-5 mb-6`}>
              <View style={twrnc`flex-row items-center mb-4`}>
                <View style={twrnc`bg-[#4361EE] rounded-2xl p-3 mr-4`}>
                  <Ionicons
                    name={
                      todayQuest.category === "endurance"
                        ? "flash"
                        : todayQuest.category === "fitness"
                          ? "heart"
                          : todayQuest.category === "strength"
                            ? "barbell"
                            : todayQuest.category === "flexibility"
                              ? "body"
                              : "trophy"
                    }
                    size={width * 0.06}
                    color="#FFFFFF"
                  />
                </View>
                <View style={twrnc`flex-1`}>
                  <View style={twrnc`flex-row items-center justify-between mb-1 flex-wrap`}>
                    <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes.lg }]}>
                      {todayQuest.title}
                    </CustomText>
                    <View style={twrnc`bg-[#FFC107] rounded-full px-3 py-1`}>
                      <CustomText style={[twrnc`text-[#121826]`, { fontSize: responsiveFontSizes.xs }]}>
                        +{todayQuest.xpReward} XP
                      </CustomText>
                    </View>
                  </View>
                  <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.sm }]}>
                    {todayQuest.description}
                  </CustomText>
                  <View style={twrnc`flex-row items-center flex-wrap mt-2`}>
                    <View style={twrnc`bg-[#3A3F4B] rounded-full px-3 py-1 mr-2 mb-1`}>
                      <CustomText style={[twrnc`text-white`, { fontSize: responsiveFontSizes.xs }]}>
                        {todayQuest.difficulty.charAt(0).toUpperCase() + todayQuest.difficulty.slice(1)}
                      </CustomText>
                    </View>
                    <CustomText style={[twrnc`text-[#4361EE]`, { fontSize: responsiveFontSizes.xs }]}>
                      {todayQuest.category.charAt(0).toUpperCase() + todayQuest.category.slice(1)}
                    </CustomText>
                  </View>
                </View>
              </View>
              {/* Progress Bar */}
              <View style={twrnc`mb-4`}>
                <View style={twrnc`flex-row justify-between items-center mb-2`}>
                  <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.sm }]}>
                    Progress
                  </CustomText>
                  <CustomText style={[twrnc`text-[#FFC107]`, { fontSize: responsiveFontSizes.sm }]}>
                    {Math.round(calculateQuestProgress(todayQuest) * 100)}% •{" "}
                    {getCurrentQuestValue(todayQuest).toFixed(2)}/{todayQuest.goal.toFixed(2)} {todayQuest.unit}
                  </CustomText>
                </View>
                <View style={twrnc`h-3 bg-[#3A3F4B] rounded-full overflow-hidden`}>
                  <View
                    style={[
                      twrnc`h-3 rounded-full`,
                      {
                        width: `${calculateQuestProgress(todayQuest) * 100}%`,
                        backgroundColor: getQuestStatus(todayQuest) === "completed" ? "#06D6A0" : "#FFC107",
                      },
                    ]}
                  />
                </View>
              </View>
              {/* Action Buttons */}
              <View style={twrnc`flex-row`}>
                <TouchableOpacity
                  style={[
                    twrnc`flex-1 rounded-2xl py-3 items-center mr-3`,
                    getQuestStatus(todayQuest) === "completed" ? twrnc`bg-[#06D6A0]` : twrnc`bg-[#4361EE]`,
                  ]}
                  onPress={() => navigateToQuestActivity(todayQuest)}
                >
                  <CustomText weight="bold" style={twrnc`text-white`}>
                    {getQuestStatus(todayQuest) === "completed" ? "Completed ✓" : "Start Quest"}
                  </CustomText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`bg-[#3A3F4B] rounded-2xl py-3 px-4 items-center`}
                  onPress={() => setIsQuestModalVisible(true)}
                >
                  <Ionicons name="list" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Last Activity Section - Made responsive */}
          <View style={twrnc`px-0 mb-20`}>
            <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes.xl }]}>
              Recent Activity
            </CustomText>
            {activityData.coordinates.length > 0 || activityData.activityType !== "walking" ? (
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] rounded-2xl overflow-hidden mb-4 shadow-md`}
                onPress={() => viewActivityDetails(activityData)}
              >
                {/* Map Section - Responsive height */}
                {activityData.coordinates.length > 0 && (
                  <View style={{ height: height * 0.2 }}>
                    <MapView
                      style={twrnc`w-full h-full`}
                      initialRegion={calculateMapRegion(activityData.coordinates)}
                      customMapStyle={[
                        { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
                        { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
                        { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
                        { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFC107" }] },
                        { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
                      ]}
                      provider={PROVIDER_GOOGLE}
                      scrollEnabled={false}
                      zoomEnabled={false}
                      pitchEnabled={false}
                      rotateEnabled={false}
                    >
                      <Polyline coordinates={activityData.coordinates} strokeColor="#4361EE" strokeWidth={4} />
                    </MapView>
                  </View>
                )}
                {/* Activity Details - Responsive */}
                <View style={twrnc`p-4`}>
                  <View style={twrnc`flex-row justify-between items-center mb-2`}>
                    <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes.base }]}>
                      {activityData.activityType.charAt(0).toUpperCase() + activityData.activityType.slice(1)} Workout
                    </CustomText>
                    <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                      {formatDate()}
                    </CustomText>
                  </View>
                  <View style={twrnc`flex-row justify-between items-center`}>
                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                        Distance
                      </CustomText>
                      <CustomText weight="bold" style={[twrnc`text-[#06D6A0]`, { fontSize: responsiveFontSizes.base }]}>
                        {activityData.distance}
                      </CustomText>
                    </View>
                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                        Duration
                      </CustomText>
                      <CustomText weight="bold" style={[twrnc`text-[#FFC107]`, { fontSize: responsiveFontSizes.base }]}>
                        {activityData.duration}
                      </CustomText>
                    </View>
                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>
                        Pace
                      </CustomText>
                      <CustomText weight="bold" style={[twrnc`text-[#4361EE]`, { fontSize: responsiveFontSizes.base }]}>
                        {activityData.stats.pace}
                      </CustomText>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ) : (
              // No Activity State - Responsive
              <View style={twrnc`bg-[#2A2E3A] rounded-2xl p-6 items-center`}>
                <View style={twrnc`bg-[#4361EE] bg-opacity-20 rounded-2xl p-4 mb-4`}>
                  <Ionicons name="fitness" size={width * 0.08} color="#4361EE" />
                </View>
                <CustomText weight="bold" style={[twrnc`text-white`, { fontSize: responsiveFontSizes.xl }]}>
                  Ready to Start?
                </CustomText>
                <CustomText style={[twrnc`text-gray-400 text-center mb-6 leading-5`, { fontSize: responsiveFontSizes.sm }]}>
                  No activities yet. Start tracking your first workout to see your progress here!
                </CustomText>
                <View style={twrnc`flex-row flex-wrap justify-center gap-3 w-full`}>
                  <TouchableOpacity
                    style={twrnc`bg-[#4361EE] px-6 py-3 rounded-2xl flex-1 min-w-32 items-center`}
                    onPress={() => navigateToActivity()}
                  >
                    <Ionicons name="play" size={16} color="#FFFFFF" style={twrnc`mb-1`} />
                    <CustomText weight="bold" style={twrnc`text-white text-sm`}>
                      Start Activity
                    </CustomText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={twrnc`bg-[#2A2E3A] border border-[#4361EE] px-6 py-3 rounded-2xl flex-1 min-w-32 items-center`}
                    onPress={() => navigateToActivity({ activityType: "walking" })}
                  >
                    <Ionicons name="walk" size={16} color="#4361EE" style={twrnc`mb-1`} />
                    <CustomText weight="bold" style={twrnc`text-[#4361EE] text-sm`}>
                      Quick Walk
                    </CustomText>
                  </TouchableOpacity>
                </View>
                {/* Motivational Stats - Responsive */}
                <View style={twrnc`flex-row justify-between w-full mt-6 pt-4 border-t border-[#3A3F4B]`}>
                  <View style={twrnc`items-center flex-1`}>
                    <CustomText style={[twrnc`text-[#FFC107]`, { fontSize: responsiveFontSizes.lg }]}>0</CustomText>
                    <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>Activities</CustomText>
                  </View>
                  <View style={twrnc`items-center flex-1`}>
                    <CustomText style={[twrnc`text-[#4361EE]`, { fontSize: responsiveFontSizes.lg }]}>
                      Level {userStats.level}
                    </CustomText>
                    <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>Current Level</CustomText>
                  </View>
                  <View style={twrnc`items-center flex-1`}>
                    <CustomText style={[twrnc`text-[#06D6A0]`, { fontSize: responsiveFontSizes.lg }]}>
                      {userStats.totalXP}
                    </CustomText>
                    <CustomText style={[twrnc`text-gray-400`, { fontSize: responsiveFontSizes.xs }]}>Total XP</CustomText>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Dynamic Quest List Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isQuestModalVisible}
        onRequestClose={() => setIsQuestModalVisible(false)}
      >
        <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
          <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-3/4`}>
            <View style={twrnc`flex-row justify-between items-center mb-6`}>
              <View>
                <CustomText weight="bold" style={twrnc`text-white text-2xl`}>
                  Daily Quests
                </CustomText>
                <CustomText style={twrnc`text-gray-400 text-sm`}>
                  Personalized challenges based on your performance
                </CustomText>
              </View>
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] p-3 rounded-2xl`}
                onPress={() => setIsQuestModalVisible(false)}
              >
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {dynamicQuests.length > 0 ? (
                dynamicQuests.map((quest, index) => {
                  const progress = calculateQuestProgress(quest)
                  const status = getQuestStatus(quest)
                  return (
                    <View key={index} style={twrnc`bg-[#2A2E3A] rounded-2xl p-4 mb-4`}>
                      <View style={twrnc`flex-row items-center mb-3`}>
                        <View style={twrnc`bg-[#4361EE] rounded-2xl p-3 mr-4`}>
                          <Ionicons
                            name={
                              quest.category === "endurance"
                                ? "flash"
                                : quest.category === "fitness"
                                  ? "heart"
                                  : quest.category === "strength"
                                    ? "barbell"
                                    : quest.category === "flexibility"
                                      ? "body"
                                      : "trophy"
                            }
                            size={20}
                            color="#FFFFFF"
                          />
                        </View>
                        <View style={twrnc`flex-1`}>
                          <View style={twrnc`flex-row items-center justify-between mb-1`}>
                            <CustomText weight="bold" style={twrnc`text-white text-base`}>
                              {quest.title}
                            </CustomText>
                            <View style={twrnc`bg-[#FFC107] rounded-full px-2 py-1`}>
                              <CustomText style={twrnc`text-[#121826] text-xs font-bold`}>
                                +{quest.xpReward} XP
                              </CustomText>
                            </View>
                          </View>
                          <CustomText style={twrnc`text-gray-400 text-sm mb-2`}>{quest.description}</CustomText>
                          <View style={twrnc`flex-row items-center`}>
                            <View style={twrnc`bg-[#3A3F4B] rounded-full px-2 py-1 mr-2`}>
                              <CustomText style={twrnc`text-white text-xs`}>
                                {quest.difficulty.charAt(0).toUpperCase() + quest.difficulty.slice(1)}
                              </CustomText>
                            </View>
                            <CustomText style={twrnc`text-[#4361EE] text-xs`}>
                              {quest.category.charAt(0).toUpperCase() + quest.category.slice(1)}
                            </CustomText>
                          </View>
                        </View>
                      </View>
                      {/* Progress */}
                      <View style={twrnc`mb-3`}>
                        <View style={twrnc`flex-row justify-between items-center mb-2`}>
                          <CustomText style={twrnc`text-gray-400 text-xs`}>Progress</CustomText>
                          <CustomText
                            style={[
                              twrnc`text-xs font-medium`,
                              status === "completed" ? twrnc`text-[#06D6A0]` : twrnc`text-[#FFC107]`,
                            ]}
                          >
                            {Math.round(progress * 100)}%
                          </CustomText>
                        </View>
                        <View style={twrnc`h-2 bg-[#3A3F4B] rounded-full overflow-hidden`}>
                          <View
                            style={[
                              twrnc`h-2 rounded-full`,
                              {
                                width: `${progress * 100}%`,
                                backgroundColor: status === "completed" ? "#06D6A0" : "#FFC107",
                              },
                            ]}
                          />
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[
                          twrnc`rounded-2xl py-3 items-center`,
                          status === "completed" ? twrnc`bg-[#06D6A0]` : twrnc`bg-[#4361EE]`,
                        ]}
                        onPress={() => navigateToQuestActivity(quest)}
                      >
                        <CustomText weight="bold" style={twrnc`text-white`}>
                          {status === "completed" ? "Completed ✓" : "Start Quest"}
                        </CustomText>
                      </TouchableOpacity>
                    </View>
                  )
                })
              ) : (
                <View style={twrnc`items-center justify-center py-10`}>
                  <Ionicons name="trophy" size={48} color="#6B7280" style={twrnc`mb-4`} />
                  <CustomText style={twrnc`text-gray-400 text-center`}>
                    Complete more activities to unlock personalized quests!
                  </CustomText>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Activity Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isActivityModalVisible}
        onRequestClose={() => setIsActivityModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsActivityModalVisible(false)}>
          <View style={styles.modalContainer}>
            {/* Changed from Pressable to View */}
            <View style={styles.modalContent}>
              {/* Modal Header */}
              <View style={twrnc`flex-row justify-between items-center mb-6`}>
                <CustomText weight="bold" style={twrnc`text-white text-2xl`}>
                  Activity Details
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] p-3 rounded-2xl`}
                  onPress={() => setIsActivityModalVisible(false)}
                >
                  <Ionicons name="close" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              {/* Map */}
              {selectedActivity && selectedActivity.coordinates && selectedActivity.coordinates.length > 0 ? (
                <View style={twrnc`w-full h-60 rounded-2xl overflow-hidden mb-6`}>
                  <MapView
                    style={twrnc`w-full h-full`}
                    initialRegion={calculateMapRegion(selectedActivity.coordinates)}
                    customMapStyle={[
                      { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
                      { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
                      { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
                      { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFC107" }] },
                      { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
                    ]}
                    provider={PROVIDER_GOOGLE}
                    scrollEnabled={true}
                    zoomEnabled={true}
                    pitchEnabled={false}
                    rotateEnabled={false}
                  >
                    <Polyline
                      coordinates={selectedActivity.coordinates}
                      strokeColor="#4361EE"
                      strokeWidth={4}
                      lineCap="round"
                      lineJoin="round"
                    />
                  </MapView>
                  {/* Activity Type Badge */}
                  <View style={twrnc`absolute top-4 left-4 bg-[#121826] bg-opacity-80 rounded-full px-3 py-1`}>
                    <CustomText style={twrnc`text-white text-sm font-medium`}>
                      {selectedActivity.activityType.charAt(0).toUpperCase() + selectedActivity.activityType.slice(1)}
                    </CustomText>
                  </View>
                </View>
              ) : (
                <View style={twrnc`w-full h-40 bg-[#2A2E3A] justify-center items-center rounded-2xl mb-6`}>
                  <Ionicons name="map" size={32} color="#6B7280" style={twrnc`mb-2`} />
                  <CustomText style={twrnc`text-gray-400 text-sm text-center`}>No route data available</CustomText>
                </View>
              )}

              {/* Activity Stats */}
              {selectedActivity && (
                <View style={twrnc`bg-[#2A2E3A] rounded-2xl p-5 mb-6`}>
                  <CustomText weight="bold" style={twrnc`text-white text-lg mb-4`}>
                    Activity Summary
                  </CustomText>
                  <View style={twrnc`flex-row justify-between mb-4`}>
                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Distance</CustomText>
                      <CustomText weight="bold" style={twrnc`text-[#06D6A0] text-xl`}>
                        {selectedActivity.distance
                          ? `${Number.parseFloat(selectedActivity.distance).toFixed(2)} km`
                          : "0 km"}
                      </CustomText>
                    </View>
                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Duration</CustomText>
                      <CustomText weight="bold" style={twrnc`text-[#FFC107] text-xl`}>
                        {selectedActivity.duration
                          ? typeof selectedActivity.duration === "number"
                            ? formatTime(selectedActivity.duration)
                            : selectedActivity.duration
                          : "0:00"}
                      </CustomText>
                    </View>
                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>
                        {selectedActivity.activityType === "cycling" ? "Speed" : "Pace"}
                      </CustomText>
                      <CustomText weight="bold" style={twrnc`text-[#4361EE] text-xl`}>
                        {selectedActivity.activityType === "cycling"
                          ? (selectedActivity.avgSpeed ?? selectedActivity.stats?.avgSpeed ?? "0")
                            .toString()
                            .includes("km/h")
                            ? (selectedActivity.avgSpeed ?? selectedActivity.stats?.avgSpeed ?? "0 km/h")
                            : `${Number.parseFloat(selectedActivity.avgSpeed ?? selectedActivity.stats?.avgSpeed ?? 0).toFixed(1)} km/h`
                          : selectedActivity.pace
                            ? (typeof selectedActivity.pace === "number"
                              ? formatTime(selectedActivity.pace)
                              : selectedActivity.pace) + "/km"
                            : selectedActivity.stats?.pace || "0:00/km"}
                      </CustomText>
                    </View>
                  </View>
                  <View style={twrnc`flex-row justify-between`}>
                    <View style={twrnc`flex-1 mr-2`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Activity Type</CustomText>
                      <CustomText style={twrnc`text-white`}>
                        {selectedActivity.activityType.charAt(0).toUpperCase() + selectedActivity.activityType.slice(1)}
                      </CustomText>
                    </View>
                    <View style={twrnc`flex-1`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Date</CustomText>
                      <CustomText style={twrnc`text-white`}>
                        {selectedActivity.createdAt
                          ? formatDate(
                            selectedActivity.createdAt.toDate
                              ? selectedActivity.createdAt.toDate()
                              : selectedActivity.createdAt,
                          )
                          : ""}
                      </CustomText>
                    </View>
                  </View>
                </View>
              )}

              {/* Action Buttons */}
              <View style={twrnc`flex-row`}>
                <TouchableOpacity
                  style={twrnc`bg-[#4361EE] rounded-2xl py-3 px-4 flex-1 mr-3`}
                  onPress={resumeActivity}
                >
                  <CustomText weight="bold" style={twrnc`text-white text-center`}>
                    Resume Activity
                  </CustomText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`border border-[#EF476F] rounded-2xl py-3 px-4 flex-1`}
                  onPress={clearActivity}
                >
                  <CustomText weight="bold" style={twrnc`text-[#EF476F] text-center`}>
                    Clear Activity
                  </CustomText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Date Activities Modal - Enhanced for all activity types */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isDateActivitiesModalVisible}
        onRequestClose={() => setIsDateActivitiesModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsDateActivitiesModalVisible(false)}>
          <View style={styles.modalContainer}>
            {/* Changed from Pressable to View */}
            <View style={styles.modalContent}>
              {/* Modal Header */}
              <View style={twrnc`flex-row justify-between items-center mb-6`}>
                <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                  Activities for {formatDate(selectedCalendarDate)}
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] p-3 rounded-2xl`}
                  onPress={() => setIsDateActivitiesModalVisible(false)}
                >
                  <Ionicons name="close" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
              <ScrollView style={twrnc`max-h-96`}>
                {dateActivities.length > 0 ? (
                  dateActivities.map((activity, index) => {
                    const displayInfo = activity.displayInfo || getActivityDisplayInfo(activity)
                    return (
                      <View key={index} style={twrnc`mb-4 bg-[#2A2E3A] rounded-2xl p-4`}>
                        {/* Activity Header */}
                        <View style={twrnc`flex-row justify-between items-center mb-3`}>
                          <CustomText weight="bold" style={twrnc`text-white`}>
                            {activity.activityType.charAt(0).toUpperCase() + activity.activityType.slice(1)}
                          </CustomText>
                          <CustomText style={twrnc`text-gray-400 text-sm`}>{activity.formattedTime}</CustomText>
                        </View>
                        {/* Mini Map for distance-based activities */}
                        {activity.coordinates && activity.coordinates.length > 0 && (
                          <View style={twrnc`h-32 rounded-2xl overflow-hidden mb-3`}>
                            <MapView
                              style={twrnc`w-full h-full`}
                              initialRegion={calculateMapRegion(activity.coordinates)}
                              scrollEnabled={false}
                              zoomEnabled={false}
                              pitchEnabled={false}
                              rotateEnabled={false}
                            >
                              <Polyline coordinates={activity.coordinates} strokeColor="#4361EE" strokeWidth={3} />
                            </MapView>
                          </View>
                        )}
                        {/* Dynamic Activity Stats based on type */}
                        <View style={twrnc`flex-row justify-between mb-4`}>
                          <View style={twrnc`items-center flex-1`}>
                            <View style={twrnc`flex-row items-center mb-1`}>
                              <Ionicons
                                name={displayInfo.primaryMetric.icon}
                                size={14}
                                color={displayInfo.primaryMetric.color}
                                style={twrnc`mr-1`}
                              />
                              <CustomText style={twrnc`text-gray-400 text-xs`}>
                                {displayInfo.primaryMetric.label}
                              </CustomText>
                            </View>
                            <CustomText style={twrnc`text-white font-bold`}>
                              {displayInfo.primaryMetric.value}
                            </CustomText>
                          </View>
                          <View style={twrnc`items-center flex-1`}>
                            <View style={twrnc`flex-row items-center mb-1`}>
                              <Ionicons
                                name={displayInfo.secondaryMetric.icon}
                                size={14}
                                color={displayInfo.secondaryMetric.color}
                                style={twrnc`mr-1`}
                              />
                              <CustomText style={twrnc`text-gray-400 text-xs`}>
                                {displayInfo.secondaryMetric.label}
                              </CustomText>
                            </View>
                            <CustomText style={twrnc`text-white font-bold`}>
                              {displayInfo.secondaryMetric.value}
                            </CustomText>
                          </View>
                          <View style={twrnc`items-center flex-1`}>
                            <View style={twrnc`flex-row items-center mb-1`}>
                              <Ionicons
                                name={displayInfo.tertiaryMetric.icon}
                                size={14}
                                color={displayInfo.tertiaryMetric.color}
                                style={twrnc`mr-1`}
                              />
                              <CustomText style={twrnc`text-gray-400 text-xs`}>
                                {displayInfo.tertiaryMetric.label}
                              </CustomText>
                            </View>
                            <CustomText style={twrnc`text-white font-bold`}>
                              {displayInfo.tertiaryMetric.value}
                            </CustomText>
                          </View>
                        </View>
                        {/* View Details Button */}
                        <TouchableOpacity
                          style={twrnc`bg-[#4361EE] rounded-2xl py-3 items-center`}
                          onPress={() => {
                            setIsDateActivitiesModalVisible(false)
                            viewActivityDetails(activity)
                          }}
                        >
                          <CustomText weight="bold" style={twrnc`text-white`}>
                            View Details
                          </CustomText>
                        </TouchableOpacity>
                      </View>
                    )
                  })
                ) : (
                  <View style={twrnc`items-center justify-center py-10`}>
                    <Ionicons name="calendar" size={48} color="#6B7280" />
                    <CustomText style={twrnc`text-gray-400 mt-3`}>No activities for this day</CustomText>
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Badge Detail Modal - KEPT */}
      <BadgeModal visible={false} badge={null} onClose={() => { }} />
      {/* Badge Notification Modal - KEPT */}
      <BadgeNotification visible={false} badges={[]} onClose={() => { }} />
      {/* All Badges Modal - KEPT */}
      <AllBadgesModal visible={false} badges={[]} onClose={() => { }} onBadgePress={() => { }} />
    </View>
  )
}

// Update styles to be responsive
const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "90%",
    maxWidth: 400, // Maximum width for larger devices
    maxHeight: "80%",
  },
  modalContent: {
    backgroundColor: "#121826",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
})

export default DashboardScreen

