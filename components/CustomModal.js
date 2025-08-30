"use client"

import { useEffect } from "react"
import { Modal, View, TouchableOpacity, Image, Dimensions, Platform } from "react-native"
import twrnc from "twrnc"
import { FontAwesome } from "@expo/vector-icons"
import CustomText from "./CustomText"

const { width } = Dimensions.get("window")
const isSmallDevice = width < 375

const CustomModal = ({
  visible,
  onClose,
  onConfirm,
  onCancel,
  icon,
  title,
  message,
  type = "success",
  showCancelButton = false,
  confirmText = "OK",
  cancelText = "Cancel",
  image = null,
  buttons = [],
}) => {
  useEffect(() => {
    // You can add side effects here if needed
  }, [message, title, type, visible])

  return (
    <Modal animationType="fade" transparent={true} visible={visible} onRequestClose={onClose}>
      <View style={twrnc`flex-1 justify-center items-center bg-black/50`}>
        <View
          style={twrnc`bg-[#1E2538] p-6 rounded-2xl w-11/12 max-w-md shadow-lg ${Platform.OS === "android" ? "elevation-8" : ""}`}
        >
          <View style={twrnc`items-center mb-4`}>
            {image ? (
              <Image source={{ uri: image }} style={twrnc`w-20 h-20 rounded-full mb-4`} resizeMode="contain" />
            ) : (
              <View
                style={twrnc`w-16 h-16 rounded-full items-center justify-center mb-4 ${
                  type === "success"
                    ? "bg-green-100"
                    : type === "error"
                      ? "bg-red-100"
                      : type === "info"
                        ? "bg-blue-100"
                        : "bg-yellow-100"
                }`}
              >
                <FontAwesome
                  name={
                    icon ||
                    (type === "success"
                      ? "check"
                      : type === "error"
                        ? "exclamation-circle"
                        : type === "info"
                          ? "info-circle"
                          : "bell")
                  }
                  size={32}
                  color={
                    type === "success"
                      ? "#10B981"
                      : type === "error"
                        ? "#EF4444"
                        : type === "info"
                          ? "#3B82F6"
                          : "#F59E0B"
                  }
                />
              </View>
            )}
            <CustomText weight="bold" style={twrnc`text-xl text-white mb-2 text-center`}>
              {title}
            </CustomText>
            <CustomText style={twrnc`text-gray-300 text-center`}>{message}</CustomText>
          </View>
          <View
            style={twrnc`flex-row ${buttons.length > 0 ? "justify-around" : showCancelButton ? "justify-between" : "justify-center"} mt-4`}
          >
            {buttons.length > 0 ? (
              buttons.map((button, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    twrnc`flex-1 py-3 rounded-xl items-center mx-1`,
                    button.style === "primary" && twrnc`bg-[#4361EE]`,
                    button.style === "danger" && twrnc`bg-[#EF476F]`,
                    button.style === "secondary" && twrnc`bg-gray-600`,
                    button.style === "outline" && twrnc`border border-gray-500`,
                  ]}
                  activeOpacity={0.7}
                  onPress={() => {
                    // MODIFIED: Only close if button.action() does not return false
                    const shouldClose = button.action()
                    if (shouldClose !== false) {
                      onClose()
                    }
                  }}
                >
                  <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-sm" : "text-base"}`}>
                    {button.label}
                  </CustomText>
                </TouchableOpacity>
              ))
            ) : (
              <View style={twrnc`flex-row w-full`}>
                {showCancelButton && (
                  <TouchableOpacity
                    style={twrnc`bg-[#2A2E3A] py-3 rounded-lg items-center flex-1 mr-2`}
                    onPress={onCancel || onClose}
                  >
                    <CustomText weight="bold" style={twrnc`text-white`}>
                      {cancelText}
                    </CustomText>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={twrnc`bg-[#4361EE] py-3 rounded-lg items-center ${showCancelButton ? "flex-1 ml-2" : "w-full"}`}
                  onPress={onConfirm || onClose}
                >
                  <CustomText weight="bold" style={twrnc`text-white`}>
                    {confirmText}
                  </CustomText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

export default CustomModal
