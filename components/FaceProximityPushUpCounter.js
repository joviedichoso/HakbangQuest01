"use client"

import { useEffect, useState, useRef } from "react"
import { StyleSheet, View, Text, useWindowDimensions, TouchableOpacity } from "react-native"
import { Camera as VisionCamera, useCameraDevice, useCameraPermission } from "react-native-vision-camera"
import { Camera } from "react-native-vision-camera-face-detector"
import { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated"
import Animated from "react-native-reanimated"
import { Accelerometer } from "expo-sensors"   // ✅ flatness detection

export default function FaceProximityPushUpCounter() {
  const { hasPermission } = useCameraPermission()
  const { width, height } = useWindowDimensions()
  const [pushUpCount, setPushUpCount] = useState(0)
  const [currentState, setCurrentState] = useState("calibrating")
  const [calibrationCountdown, setCalibrationCountdown] = useState(3)
  const [debugInfo, setDebugInfo] = useState("")
  const [isFlat, setIsFlat] = useState(true) // ✅ check if phone is flat

  const device = useCameraDevice("front")

  // Face size tracking
  const baselineFaceSize = useRef(0)
  const downThreshold = useRef(0)
  const upThreshold = useRef(0)
  const lastStateChange = useRef(0)
  const minStateChangeInterval = 600
  const calibrationSamples = useRef([])
  const recentFaceSizes = useRef([])
  const smoothingWindow = 3

  // ✅ Accelerometer subscription for flatness
  useEffect(() => {
    let subscription
    const subscribe = () => {
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        // Phone is flat if Z-axis is dominant (gravity ≈ 1g) and not tilted much
        const isOnGround = Math.abs(z) > 0.9 && Math.abs(x) < 0.2 && Math.abs(y) < 0.2
        setIsFlat(isOnGround)
      })
      Accelerometer.setUpdateInterval(500) // check every 0.5s
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

  const finishCalibration = () => {
    if (!isFlat) {
      setDebugInfo("⚠️ Place phone flat on the ground for calibration")
      setCalibrationCountdown(3)
      return
    }

    if (calibrationSamples.current.length > 10) {
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
      setCalibrationCountdown(3)
      calibrationSamples.current = []
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
      setDebugInfo(
        `Calibrating... ${calibrationCountdown}s\nSamples: ${calibrationSamples.current.length}\nCurrent size: ${faceArea.toFixed(0)}`,
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
    borderRadius: 10,
    width: withTiming(aFaceW.value, { duration: 150 }),
    height: withTiming(aFaceH.value, { duration: 150 }),
    left: withTiming(aFaceX.value, { duration: 150 }),
    top: withTiming(aFaceY.value, { duration: 150 }),
  }))

  const faceDetectionOptions = useRef({
    performanceMode: "accurate",
    landmarkMode: "none",
    contourMode: "none",
    classificationMode: "none",
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

  if (!hasPermission) return <Text style={styles.errorText}>Camera permission is required.</Text>
  if (device == null) return <Text style={styles.errorText}>Camera device not found.</Text>

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        faceDetectionCallback={handleFacesDetection}
        faceDetectionOptions={faceDetectionOptions}
      />

      {/* Counter Display */}
      <View style={styles.counterContainer}>
        <Text style={styles.counterText}>{pushUpCount}</Text>
        <Text style={styles.counterLabel}>PUSH-UPS</Text>
        <View style={styles.statusContainer}>
          <Text
            style={[
              styles.statusText,
              {
                color: currentState === "down" ? "#ff3333" : currentState === "up" ? "#33ff33" : "#ffff33",
              },
            ]}
          >
            {!isFlat
              ? "⚠️ NOT FLAT"
              : currentState === "calibrating"
              ? `CALIBRATING ${calibrationCountdown}`
              : currentState === "down"
              ? "🔴 DOWN"
              : "🟢 UP"}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.resetButton} onPress={resetCounter}>
        <Text style={styles.resetButtonText}>RESET</Text>
      </TouchableOpacity>

      <Animated.View style={faceBoxStyle} />

      <View style={styles.instructionsContainer}>
        <Text style={styles.instructionsTitle}>📱 GROUND PUSH-UP COUNTER</Text>
        <Text style={styles.instructionsText}>
          {currentState === "calibrating"
            ? "1. Place phone flat on ground\n2. Get in push-up position\n3. Hold steady for calibration"
            : "✅ Ready! Do push-ups above the phone.\nFace size + flat phone will trigger UP/DOWN."}
        </Text>
      </View>

      <View style={styles.debugContainer}>
        <Text style={styles.debugText}>{debugInfo}</Text>
      </View>

      {!isFlat && (
        <View style={styles.warningContainer}>
          <Text style={styles.warningText}>⚠️ Keep phone flat on the ground!</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  counterContainer: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: 25,
    padding: 25,
  },
  counterText: {
    color: "white",
    fontSize: 90,
    fontWeight: "bold",
    textAlign: "center",
  },
  counterLabel: {
    color: "#33ff33",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: -15,
  },
  statusContainer: {
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 15,
  },
  statusText: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  resetButton: {
    position: "absolute",
    top: 70,
    right: 30,
    backgroundColor: "rgba(255, 0, 0, 0.8)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
  },
  resetButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  instructionsContainer: {
    position: "absolute",
    bottom: 140,
    left: 20,
    right: 20,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: 20,
    padding: 20,
  },
  instructionsTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  instructionsText: {
    color: "white",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  debugContainer: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 15,
    padding: 15,
  },
  debugText: {
    color: "#cccccc",
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "center",
  },
  errorText: {
    color: "red",
    fontSize: 18,
    textAlign: "center",
    marginTop: 100,
    padding: 20,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    margin: 20,
    borderRadius: 10,
  },
  warningContainer: {
    position: "absolute",
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255,0,0,0.85)",
    borderRadius: 15,
    padding: 15,
  },
  warningText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
})
