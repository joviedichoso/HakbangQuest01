"use client"
import { useState, useEffect, useRef } from "react"
import {
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
} from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import CustomModal from "../components/CustomModal"
import { auth } from "../firebaseConfig"
import NotificationService from "../services/NotificationService"
import { signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from "firebase/auth"
import { FontAwesome, Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"

const { width, height } = Dimensions.get("window")
const isSmallDevice = width < 375

const LoginScreen = ({ navigateToLanding, navigateToSignUp, navigateToDashboard, prefilledEmail }) => {
  const [email, setEmail] = useState(prefilledEmail || "")
  const [password, setPassword] = useState("")
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isEmailFocused, setIsEmailFocused] = useState(false)
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState({ email: "", password: "" })
  const [modalVisible, setModalVisible] = useState(false)
  const [modalTitle, setModalTitle] = useState("")
  const [modalMessage, setModalMessage] = useState("")
  const [modalType, setModalType] = useState("error")
  const [registeredEmails, setRegisteredEmails] = useState([])
  const [userForVerification, setUserForVerification] = useState(null)

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(50)).current
  const headerSlideAnim = useRef(new Animated.Value(-50)).current
  const buttonScaleAnim = useRef(new Animated.Value(1)).current
  const inputShakeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loadEmails = async () => {
      try {
        const storedEmails = await AsyncStorage.getItem("registeredEmails")
        if (storedEmails) {
          setRegisteredEmails(JSON.parse(storedEmails))
        }
      } catch (error) {
        console.error("Error loading emails from AsyncStorage:", error)
      }
    }
    loadEmails()

    // Start entrance animations
    animateScreenElements()
  }, [])

  useEffect(() => {
    setEmail(prefilledEmail || "")
  }, [prefilledEmail])

  const animateScreenElements = () => {
    fadeAnim.setValue(0)
    slideAnim.setValue(50)
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
      Animated.timing(headerSlideAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }

  const animateButtonPress = () => {
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start()
  }

  const animateInputError = () => {
    Animated.sequence([
      Animated.timing(inputShakeAnim, {
        toValue: 10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(inputShakeAnim, {
        toValue: -10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(inputShakeAnim, {
        toValue: 10,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(inputShakeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start()
  }

  const handleEmailSignIn = async () => {
    let hasError = false
    const newErrors = { email: "", password: "" }

    if (!email) {
      newErrors.email = "Email is required"
      hasError = true
    }
    if (!password) {
      newErrors.password = "Password is required"
      hasError = true
    }

    setErrors(newErrors)

    if (hasError) {
      animateInputError()
      return
    }

    animateButtonPress()
    setIsLoading(true)

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      const user = userCredential.user

      if (!user.emailVerified) {
        setModalTitle("Email Not Verified")
        setModalMessage("Please verify your email address to log in. Check your inbox for the verification email.")
        setModalType("warning")
        setModalVisible(true)
        setUserForVerification(user)
        await NotificationService.sendVerifyAccountNotification()
      } else {
        navigateToDashboard()
        const displayName = user.displayName || user.email.split("@")[0]
        await NotificationService.sendWelcomeBackNotification(displayName)
      }
    } catch (error) {
      setModalTitle("Login Failed")
      setModalMessage(getErrorMessage(error.code))
      setModalType("error")
      setModalVisible(true)
    } finally {
      setIsLoading(false)
    }
  }

  const getErrorMessage = (errorCode) => {
    switch (errorCode) {
      case "auth/user-not-found":
        return "No account found with this email address."
      case "auth/wrong-password":
        return "Incorrect password. Please try again."
      case "auth/invalid-email":
        return "Please enter a valid email address."
      case "auth/user-disabled":
        return "This account has been disabled."
      case "auth/too-many-requests":
        return "Too many failed attempts. Please try again later."
      default:
        return "Login failed. Please check your credentials and try again."
    }
  }

  const handleResendVerification = async () => {
    if (!userForVerification) {
      setModalTitle("Error")
      setModalMessage("No user available to resend verification email.")
      setModalType("error")
      setModalVisible(true)
      return
    }

    setIsLoading(true)
    try {
      await sendEmailVerification(userForVerification)
      setModalTitle("Verification Email Sent")
      setModalMessage("A new verification email has been sent to your email address.")
      setModalType("success")
      setModalVisible(true)
    } catch (error) {
      setModalTitle("Error")
      setModalMessage(error.message)
      setModalType("error")
      setModalVisible(true)
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setModalTitle("Email Required")
      setModalMessage("Please enter your email address to reset your password.")
      setModalType("warning")
      setModalVisible(true)
      return
    }

    setIsLoading(true)
    try {
      await sendPasswordResetEmail(auth, email)
      setModalTitle("Password Reset Email Sent")
      setModalMessage(
        "A password reset email has been sent to your email address. Check your inbox and follow the instructions."
      )
      setModalType("success")
      setModalVisible(true)
    } catch (error) {
      setModalTitle("Error")
      setModalMessage(getErrorMessage(error.code))
      setModalType("error")
      setModalVisible(true)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectEmail = (selectedEmail) => {
    setEmail(selectedEmail)
    setPassword("")
    setErrors({ email: "", password: "" })
  }

  const handleModalClose = async () => {
    setModalVisible(false)
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={twrnc`flex-1 bg-[#121826]`}
    >
      {/* ScrollView with flex: 1 */}
      <ScrollView contentContainerStyle={twrnc`flex-1`}>
        {/* Fixed Header at the top, absolutely positioned */}
        <Animated.View
          style={[
            twrnc`absolute top-0 left-0 right-0 items-center pt-8 z-10`,
            { transform: [{ translateY: headerSlideAnim }], opacity: fadeAnim }
          ]}
        >
          <CustomText
            weight="medium"
            style={twrnc`text-white ${isSmallDevice ? "text-lg" : "text-xl"}`}
          >
            Sign In
          </CustomText>
        </Animated.View>

        {/* Content container with paddingTop to avoid overlap with header */}
        <View style={[twrnc`flex-1`, { paddingTop: 80, justifyContent: "center", alignItems: "center" }]}>
          {/* Welcome Section */}
          <View style={twrnc`mb-8`}>
            <CustomText
              weight="bold"
              style={twrnc`text-white ${isSmallDevice ? "text-3xl" : "text-4xl"} mb-2`}
            >
              Welcome Back
            </CustomText>
            <CustomText
              style={twrnc`text-[#8E8E93] ${isSmallDevice ? "text-sm" : "text-base"}`}
            >
              Sign in to your HakbangQuest account
            </CustomText>
          </View>

          {/* Login Form */}
          <Animated.View
            style={[twrnc`w-full px-4 mb-6`, { transform: [{ translateX: inputShakeAnim }] }]}
          >
            {/* Email Input */}
            <View style={twrnc`mb-4`}>
              <CustomText
                weight="medium"
                style={twrnc`text-white mb-2 ${isSmallDevice ? "text-sm" : "text-base"}`}
              >
                Email Address
              </CustomText>
              <View style={twrnc`relative`}>
                <TextInput
                  style={[
                    twrnc`bg-[#1E2538] rounded-xl p-4 text-white ${isEmailFocused ? "border-2 border-[#4361EE]" : "border border-gray-600"
                      } ${errors.email ? "border-red-500" : ""}`,
                    { fontFamily: "Poppins-Regular", fontSize: isSmallDevice ? 14 : 16 },
                  ]}
                  placeholder="Enter your email"
                  placeholderTextColor="#8E8E93"
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text)
                    if (errors.email) setErrors((prev) => ({ ...prev, email: "" }))
                  }}
                  onFocus={() => setIsEmailFocused(true)}
                  onBlur={() => setIsEmailFocused(false)}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
              {errors.email ? (
                <View style={twrnc`flex-row items-center mt-2`}>
                  <FontAwesome name="exclamation-circle" size={14} color="#EF4444" />
                  <CustomText style={twrnc`text-red-500 ml-2 ${isSmallDevice ? "text-xs" : "text-sm"}`}>
                    {errors.email}
                  </CustomText>
                </View>
              ) : null}
            </View>

            {/* Password Input */}
            <View style={twrnc`mb-6`}>
              <CustomText
                weight="medium"
                style={twrnc`text-white mb-2 ${isSmallDevice ? "text-sm" : "text-base"}`}
              >
                Password
              </CustomText>
              <View style={twrnc`relative`}>
                <TextInput
                  style={[
                    twrnc`bg-[#1E2538] rounded-xl p-4 pr-12 text-white ${isPasswordFocused ? "border-2 border-[#4361EE]" : "border border-gray-600"
                      } ${errors.password ? "border-red-500" : ""}`,
                    { fontFamily: "Poppins-Regular", fontSize: isSmallDevice ? 14 : 16 },
                  ]}
                  placeholder="Enter your password"
                  placeholderTextColor="#8E8E93"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text)
                    if (errors.password) setErrors((prev) => ({ ...prev, password: "" }))
                  }}
                  secureTextEntry={!isPasswordVisible}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                />
                <TouchableOpacity
                  style={twrnc`absolute right-4 top-4`}
                  onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <FontAwesome
                    name={isPasswordVisible ? "eye" : "eye-slash"}
                    size={16}
                    color="#8E8E93"
                  />
                </TouchableOpacity>
              </View>
              {errors.password ? (
                <View style={twrnc`flex-row items-center mt-2`}>
                  <FontAwesome name="exclamation-circle" size={14} color="#EF4444" />
                  <CustomText style={twrnc`text-red-500 ml-2 ${isSmallDevice ? "text-xs" : "text-sm"}`}>
                    {errors.password}
                  </CustomText>
                </View>
              ) : null}
            </View>

            {/* Sign In Button */}
            <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
              <TouchableOpacity
                style={twrnc`bg-[#4361EE] py-4 rounded-xl items-center flex-row justify-center ${isLoading ? "opacity-70" : ""
                  }`}
                onPress={handleEmailSignIn}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" style={twrnc`mr-2`} />
                ) : (
                  <FontAwesome name="sign-in" size={18} color="white" style={twrnc`mr-2`} />
                )}
                <CustomText
                  weight="bold"
                  style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}
                >
                  {isLoading ? "Signing In..." : "Sign In"}
                </CustomText>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* Forgot Password */}
          <View style={twrnc`flex-row justify-center mb-6`}>
            <TouchableOpacity onPress={handleForgotPassword} disabled={isLoading} activeOpacity={0.7}>
              <CustomText style={twrnc`text-[#FFC107] ${isSmallDevice ? "text-sm" : "text-base"}`}>
                Forgot Password?
              </CustomText>
            </TouchableOpacity>
          </View>

          {/* Sign Up Link */}
          <View style={twrnc`bg-[#1E2538] p-4 rounded-xl border border-gray-700`}>
            <View style={twrnc`flex-row justify-center items-center`}>
              <CustomText style={twrnc`text-[#8E8E93] ${isSmallDevice ? "text-sm" : "text-base"}`}>
                Don't have an account?
              </CustomText>
              <TouchableOpacity onPress={navigateToSignUp} style={twrnc`ml-1`} activeOpacity={0.7}>
                <CustomText
                  weight="bold"
                  style={twrnc`text-[#FFC107] ${isSmallDevice ? "text-sm" : "text-base"}`}
                >
                  Sign Up
                </CustomText>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Modal outside the content, remains fixed */}
        <CustomModal
          visible={modalVisible}
          onClose={handleModalClose}
          onConfirm={modalTitle === "Email Not Verified" ? handleResendVerification : handleModalClose}
          confirmText={modalTitle === "Email Not Verified" ? "Resend Verification" : "OK"}
          icon={
            modalType === "success"
              ? "check-circle"
              : modalType === "warning"
                ? "exclamation-triangle"
                : "exclamation-circle"
          }
          title={modalTitle}
          message={modalMessage}
          type={modalType}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export default LoginScreen