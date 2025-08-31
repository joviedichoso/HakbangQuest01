"use client"

import { useEffect, useState, useRef } from "react"
import { View, TouchableOpacity, Dimensions } from "react-native"
import { Camera as VisionCamera, useCameraDevice, useCameraPermission } from "react-native-vision-camera"
import { Camera } from "react-native-vision-camera-face-detector"
import { useSharedValue, useAnimatedStyle, withTiming, withSpring } from "react-native-reanimated"
import Animated, { Easing } from "react-native-reanimated"
import { Accelerometer } from "expo-sensors"
import tw from "twrnc"
import { CustomText } from "./CustomText"

// Get responsive dimensions
const { width, height } = Dimensions.get("window")
const isSmallDevice = width < 375
const isMediumDevice = width >= 375 && width < 414
const isLargeDevice = width >= 414 && width < 768
const isTablet = width >= 768

// Responsive font sizes
const responsiveFontSizes = {
  xs: isSmallDevice ? 10 : isMediumDevice ? 11 : isLargeDevice ? 12 : 14,
  sm: isSmallDevice ? 12 : isMediumDevice ? 13 : isLargeDevice ? 14 : 16,
  base: isSmallDevice ? 14 : isMediumDevice ? 15 : isLargeDevice ? 16 : 18,
  lg: isSmallDevice ? 16 : isMediumDevice ? 18 : isLargeDevice ? 20 : 22,
  xl: isSmallDevice ? 18 : isMediumDevice ? 20 : isLargeDevice ? 22 : 24,
  "2xl": isSmallDevice ? 20 : isMediumDevice ? 22 : isLargeDevice ? 24 : 28,
  "3xl": isSmallDevice ? 36 : isMediumDevice ? 40 : isLargeDevice ? 44 : 48,
}

// Responsive padding/margin
const responsivePadding = {
  sm: isSmallDevice ? 2 : isMediumDevice ? 3 : isLargeDevice ? 4 : 5,
  base: isSmallDevice ? 4 : isMediumDevice ? 5 : isLargeDevice ? 6 : 8,
  lg: isSmallDevice ? 6 : isMediumDevice ? 8 : isLargeDevice ? 10 : 12,
}

export default function FaceProximityPushUpCounter() {
  const { hasPermission } = useCameraPermission()
  const [pushUpCount, setPushUpCount] = useState(0)
  const [currentState, setCurrentState] = useState("calibrating")
  const [calibrationCountdown, setCalibrationCountdown] = useState(3)
  const [debugInfo, setDebugInfo] = useState("")
  const [isFlat, setIsFlat] = useState(true)
  const [showDebug, setShowDebug] = useState(false)

  const device = useCameraDevice("front")

  // Counter animation
  const counterScale = useSharedValue(1)
  const counterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(counterScale.value, { damping: 15, stiffness: 200 }) }],
  }))

  // Face size tracking
  const baselineFaceSize = useRef(0)
  const downThreshold = useRef(0)
  const upThreshold = useRef(0)
  const lastStateChange = useRef(0)
  const minStateChangeInterval = 600
  const calibrationSamples = useRef([])
  const recentFaceSizes = useRef([])
  const smoothingWindow = 3

  // Liveness detection
  const hasEyesOpen = useRef(false)
  const hasEyesClosed = useRef(false)

  // Accelerometer subscription for flatness
  useEffect(() => {
    let subscription
    const subscribe = () => {
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        const isOnGround = Math.abs(z) > 0.9 && Math.abs(x) < 0.2 && Math.abs(y) < 0.2
        setIsFlat(isOnGround)
      })
      Accelerometer.setUpdateInterval(500)
    }
    subscribe()
    return () => subscription && subscription.remove()
  }, [])

  useEffect(() => {
    ;(async () => {
      const status = await VisionCamera.requestCameraPermission()
      console.log(`Camera permission: ${status}`)
    })()
  }, [device])

  // Calibration countdown
  useEffect(() => {
    if (currentState === "calibrating" && calibrationCountdown > 0) {
      const timer = setTimeout(() => {
        setCalibrationCountdown((prev) => prev - 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else if (currentState === "calibrating" && calibrationCountdown === 0) {
      finishCalibration()
    }
  }, [currentState, calibrationCountdown])

  // Animate counter on increment
  useEffect(() => {
    counterScale.value = 1.2
    const timer = setTimeout(() => {
      counterScale.value = 1
    }, 200)
    return () => clearTimeout(timer)
  }, [pushUpCount])

  const finishCalibration = () => {
    if (!isFlat) {
      setDebugInfo("⚠️ Place phone flat on the ground for calibration")
      setCalibrationCountdown(3)
      return
    }

    if (calibrationSamples.current.length > 10 && hasEyesOpen.current && hasEyesClosed.current) {
      const sortedSamples = [...calibrationSamples.current].sort((a, b) => a - b)
      const trimmedSamples = sortedSamples.slice(
        Math.floor(sortedSamples.length * 0.2),
        Math.floor(sortedSamples.length * 0.8),
      )

      baselineFaceSize.current = trimmedSamples.reduce((sum, size) => sum + size, 0) / trimmedSamples.length

      downThreshold.current = baselineFaceSize.current * 1.5
      upThreshold.current = baselineFaceSize.current * 1.2

      setCurrentState("up")
      setDebugInfo(`✅ Calibrated! Baseline: ${baselineFaceSize.current.toFixed(0)}`)
    } else {
      let msg = ""
      if (calibrationSamples.current.length <= 10) {
        msg = "Not enough samples - hold steady longer"
      } else if (!hasEyesOpen.current) {
        msg = "No open eyes detected - keep eyes open most of the time"
      } else if (!hasEyesClosed.current) {
        msg = "No closed eyes detected - please blink during calibration to prevent spoofing"
      }
      setDebugInfo(msg)
      setCalibrationCountdown(3)
      calibrationSamples.current = []
      hasEyesOpen.current = false
      hasEyesClosed.current = false
    }
  }

  const smoothFaceSize = (newSize) => {
    recentFaceSizes.current.push(newSize)
    if (recentFaceSizes.current.length > smoothingWindow) {
      recentFaceSizes.current.shift()
    }
    return recentFaceSizes.current.reduce((sum, size) => sum + size, 0) / recentFaceSizes.current.length
  }

  const detectPushUpFromFaceSize = (face) => {
    if (!isFlat) {
      setDebugInfo("⚠️ Phone not flat on ground! Push-ups blocked.")
      return
    }

    const currentTime = Date.now()
    const faceArea = face.bounds.width * face.bounds.height

    if (currentState === "calibrating") {
      calibrationSamples.current.push(faceArea)
      const leftEye = face.leftEyeOpenProbability ?? 1
      const rightEye = face.rightEyeOpenProbability ?? 1

      if (leftEye < 0.4 && rightEye < 0.4) {
        hasEyesClosed.current = true
      }
      if (leftEye > 0.7 && rightEye > 0.7) {
        hasEyesOpen.current = true
      }

      setDebugInfo(
        `Calibrating... ${calibrationCountdown}s\nSamples: ${calibrationSamples.current.length}\nCurrent size: ${faceArea.toFixed(0)}\nEyes Open: L:${leftEye.toFixed(2)} R:${rightEye.toFixed(2)}\nLiveness: Open ${hasEyesOpen.current ? "✅" : "❌"} Closed ${hasEyesClosed.current ? "✅" : "❌"}`,
      )
      return
    }

    const smoothedFaceSize = smoothFaceSize(faceArea)
    if (currentTime - lastStateChange.current < minStateChangeInterval) {
      return
    }

    const sizeRatio = smoothedFaceSize / baselineFaceSize.current

    setDebugInfo(
      `State: ${currentState.toUpperCase()}\n` +
        `Face Size: ${smoothedFaceSize.toFixed(0)}\n` +
        `Baseline: ${baselineFaceSize.current.toFixed(0)}\n` +
        `Ratio: ${sizeRatio.toFixed(2)}\n` +
        `Down Threshold: ${(downThreshold.current / baselineFaceSize.current).toFixed(2)}\n` +
        (isFlat ? "📱 Flat ✅" : "⚠️ Not Flat ❌"),
    )

    if (currentState === "up" && smoothedFaceSize > downThreshold.current) {
      setCurrentState("down")
      lastStateChange.current = currentTime
    } else if (currentState === "down" && smoothedFaceSize < upThreshold.current) {
      setCurrentState("up")
      setPushUpCount((prev) => prev + 1)
      lastStateChange.current = currentTime
    }
  }

  const resetCounter = () => {
    setPushUpCount(0)
    setCurrentState("calibrating")
    setCalibrationCountdown(3)
    calibrationSamples.current = []
    recentFaceSizes.current = []
    baselineFaceSize.current = 0
    lastStateChange.current = 0
    hasEyesOpen.current = false
    hasEyesClosed.current = false
  }

  const aFaceW = useSharedValue(0)
  const aFaceH = useSharedValue(0)
  const aFaceX = useSharedValue(0)
  const aFaceY = useSharedValue(0)

  const drawFaceBounds = (face) => {
    if (face) {
      const { width, height, x, y } = face.bounds
      aFaceW.value = width
      aFaceH.value = height
      aFaceX.value = x
      aFaceY.value = y
    } else {
      aFaceW.value = aFaceH.value = aFaceX.value = aFaceY.value = 0
    }
  }

  const faceBoxStyle = useAnimatedStyle(() => ({
    position: "absolute",
    borderWidth: 4,
    borderColor: currentState === "down" ? "#ff3333" : currentState === "up" ? "#33ff33" : "#ffff33",
    borderRadius: 12,
    width: withTiming(aFaceW.value, { duration: 150, easing: Easing.inOut(Easing.ease) }),
    height: withTiming(aFaceH.value, { duration: 150, easing: Easing.inOut(Easing.ease) }),
    left: withTiming(aFaceX.value, { duration: 150, easing: Easing.inOut(Easing.ease) }),
    top: withTiming(aFaceY.value, { duration: 150, easing: Easing.inOut(Easing.ease) }),
  }))

  const resetButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(1, { duration: 100 }) }],
  }))

  const faceDetectionOptions = useRef({
    performanceMode: "accurate",
    landmarkMode: "none",
    contourMode: "none",
    classificationMode: "all",
    trackingEnabled: true,
    windowWidth: width,
    windowHeight: height,
    autoScale: true,
  }).current

  const handleFacesDetection = (faces) => {
    try {
      if (faces?.length > 0) {
        const face = faces[0]
        drawFaceBounds(face)
        detectPushUpFromFaceSize(face)
      } else {
        drawFaceBounds()
        if (currentState !== "calibrating") {
          setDebugInfo("❌ No face detected")
        }
      }
    } catch (error) {
      console.error("Error in face detection:", error)
      setDebugInfo(`Error: ${error}`)
    }
  }

  if (!hasPermission) {
    return (
      <CustomText
        weight="medium"
        style={tw.style(`text-red-500 text-center bg-white/80 rounded-xl shadow-md`, {
          fontSize: responsiveFontSizes.lg,
          marginTop: responsivePadding.lg * 6,
          marginHorizontal: responsivePadding.lg,
          padding: responsivePadding.lg,
        })}
      >
        Camera permission is required.
      </CustomText>
    )
  }
  if (device == null) {
    return (
      <CustomText
        weight="medium"
        style={tw.style(`text-red-500 text-center bg-white/80 rounded-xl shadow-md`, {
          fontSize: responsiveFontSizes.lg,
          marginTop: responsivePadding.lg * 6,
          marginHorizontal: responsivePadding.lg,
          padding: responsivePadding.lg,
        })}
      >
        Camera device not found.
      </CustomText>
    )
  }

  return (
    <View style={tw`absolute inset-0 bg-black/10`}>
      <Camera
        style={tw`absolute inset-0`}
        device={device}
        isActive={true}
        faceDetectionCallback={handleFacesDetection}
        faceDetectionOptions={faceDetectionOptions}
        resizeMode="cover"
      />

      {/* Counter Display */}
      <Animated.View
        style={tw.style(`absolute items-center bg-black/75 rounded-3xl w-[90%] shadow-md`, {
          top: responsivePadding.lg * 4,
          marginHorizontal: responsivePadding.lg,
          padding: responsivePadding.lg,
        })}
      >
        <Animated.View style={counterStyle}>
          <CustomText
            weight="bold"
            style={tw.style(`text-white text-center`, { fontSize: responsiveFontSizes["3xl"] })}
          >
            {pushUpCount}
          </CustomText>
        </Animated.View>
        <CustomText
          weight="semibold"
          style={tw.style(`text-green-400`, { fontSize: responsiveFontSizes.xl, marginTop: responsivePadding.sm })}
        >
          PUSH-UPS
        </CustomText>
        <View
          style={tw.style(`bg-white/10 rounded-2xl`, {
            marginTop: responsivePadding.base,
            paddingHorizontal: responsivePadding.lg * 1.5,
            paddingVertical: responsivePadding.sm,
          })}
        >
          <CustomText
            weight="semibold"
            style={tw.style(`text-center`, {
              fontSize: responsiveFontSizes.lg,
              color: currentState === "down" ? "#ff3333" : currentState === "up" ? "#33ff33" : "#ffff33",
            })}
          >
            {!isFlat
              ? "⚠️ NOT FLAT"
              : currentState === "calibrating"
                ? `CALIBRATING ${calibrationCountdown} ${currentState === "calibrating" ? "⏳" : ""}`
                : currentState === "down"
                  ? "🔴 DOWN"
                  : "🟢 UP"}
          </CustomText>
        </View>
      </Animated.View>

      <Animated.View style={resetButtonStyle}>
        <TouchableOpacity
          style={tw.style(`absolute bg-red-500/80 rounded-full shadow-md`, {
            top: responsivePadding.lg * 5,
            right: responsivePadding.lg * 2,
            paddingHorizontal: responsivePadding.lg * 1.5,
            paddingVertical: responsivePadding.base,
          })}
          onPress={resetCounter}
          activeOpacity={0.7}
        >
          <CustomText weight="bold" style={tw.style(`text-white`, { fontSize: responsiveFontSizes.base })}>
            RESET
          </CustomText>
        </TouchableOpacity>
      </Animated.View>

      <Animated.View style={faceBoxStyle} />

      <View
        style={tw.style(`absolute bg-black/75 rounded-2xl w-[90%] shadow-md`, {
          bottom: isSmallDevice ? responsivePadding.lg * 7 : responsivePadding.lg * 9,
          marginHorizontal: responsivePadding.lg,
          padding: responsivePadding.lg,
          maxHeight: height * 0.3,
        })}
      >
        <CustomText
          weight="bold"
          style={tw.style(`text-white text-center`, {
            fontSize: responsiveFontSizes.base,
            marginBottom: responsivePadding.base,
          })}
        >
          📱 GROUND PUSH-UP COUNTER
        </CustomText>
        <CustomText
          weight="regular"
          style={tw.style(`text-white text-center`, {
            fontSize: responsiveFontSizes.sm,
            lineHeight: responsiveFontSizes.sm * 1.5,
          })}
          numberOfLines={5}
          ellipsizeMode="tail"
        >
          {currentState === "calibrating"
            ? "1. Place phone flat on ground\n2. Get in push-up position\n3. Blink your eyes a few times\n4. Hold steady for calibration"
            : "✅ Ready! Do push-ups above the phone.\nFace size + flat phone triggers UP/DOWN."}
        </CustomText>
      </View>

      {showDebug && (
        <View
          style={tw.style(`absolute bg-black/70 rounded-2xl w-[90%] shadow-md`, {
            bottom: responsivePadding.lg,
            marginHorizontal: responsivePadding.lg,
            padding: responsivePadding.base,
          })}
        >
          <CustomText
            weight="regular"
            style={tw.style(`text-gray-300 text-center`, { fontSize: responsiveFontSizes.xs })}
          >
            {debugInfo}
          </CustomText>
        </View>
      )}

      <TouchableOpacity
        style={tw.style(`absolute bg-gray-700/80 rounded-full shadow-md`, {
          bottom: responsivePadding.lg,
          right: responsivePadding.lg * 2,
          padding: responsivePadding.sm,
        })}
        onPress={() => setShowDebug(!showDebug)}
        activeOpacity={0.7}
      >
        <CustomText weight="bold" style={tw.style(`text-white`, { fontSize: responsiveFontSizes.sm })}>
          {showDebug ? "Hide Debug" : "Show Debug"}
        </CustomText>
      </TouchableOpacity>

      {!isFlat && (
        <View
          style={tw.style(`absolute bg-red-500/75 rounded-2xl w-[90%] shadow-md`, {
            bottom: isSmallDevice ? responsivePadding.lg * 4 : responsivePadding.lg * 5,
            marginHorizontal: responsivePadding.lg,
            padding: responsivePadding.base,
          })}
        >
          <CustomText weight="bold" style={tw.style(`text-white text-center`, { fontSize: responsiveFontSizes.base })}>
            ⚠️ Keep phone flat on the ground!
          </CustomText>
        </View>
      )}
    </View>
  )
}
