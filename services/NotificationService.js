import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { Platform } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { db, auth } from "../firebaseConfig"
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  serverTimestamp,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  writeBatch,
  Timestamp,
  deleteDoc,
} from "firebase/firestore"
import { startAfter } from "firebase/firestore"

class NotificationService {
  static instance = null
  static listeners = new Map()
  static notificationQueue = []
  static isProcessingQueue = false
  static retryAttempts = new Map()
  static maxRetryAttempts = 3
  static notificationCache = new Map()
  static cacheExpiry = 5 * 60 * 1000 // 5 minutes

  // Singleton pattern
  static getInstance() {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  // Initialize the notification service
  static async initialize() {
    try {
      console.log("🔔 Initializing NotificationService...")

      // Configure notification handler
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          const { data } = notification.request.content

          return {
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            priority: data?.priority || Notifications.AndroidNotificationPriority.DEFAULT,
          }
        },
      })

      // Register for push notifications if on a device
      if (Device.isDevice) {
        const success = await this.registerForPushNotifications()
        if (success) {
          console.log("✅ Push notifications registered successfully")
        } else {
          console.warn("⚠️ Failed to register for push notifications")
        }
      } else {
        console.warn("⚠️ Push notifications only work on physical devices")
      }

      // Update badge count
      await this.updateBadgeCount()

      // Set up notification categories for iOS
      if (Platform.OS === "ios") {
        await this.setupNotificationCategories()
      }

      // Start processing queued notifications
      this.processNotificationQueue()

      console.log("✅ NotificationService initialized successfully")
      return true
    } catch (error) {
      console.error("❌ Error initializing NotificationService:", error)
      return false
    }
  }

  // Register for push notifications
  static async registerForPushNotifications() {
    try {
      // Check if we already have a valid token
      const cachedToken = await AsyncStorage.getItem("pushToken")
      const tokenTimestamp = await AsyncStorage.getItem("pushTokenTimestamp")

      // Use cached token if it's less than 24 hours old
      if (cachedToken && tokenTimestamp) {
        const tokenAge = Date.now() - Number.parseInt(tokenTimestamp)
        if (tokenAge < 24 * 60 * 60 * 1000) {
          // 24 hours
          console.log("📱 Using cached push token")
          return true
        }
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync()
      let finalStatus = existingStatus

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowAnnouncements: true,
          },
        })
        finalStatus = status
      }

      if (finalStatus !== "granted") {
        console.warn("⚠️ Push notification permissions not granted")
        return false
      }

      // Get push token with project ID
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: "a74f26e2-cc0c-4544-b860-af2692a8c3f8",
      })

      const pushToken = tokenData.data

      // Cache the token
      await AsyncStorage.setItem("pushToken", pushToken)
      await AsyncStorage.setItem("pushTokenTimestamp", Date.now().toString())

      // Save token to user profile in Firestore
      const user = auth.currentUser
      if (user) {
        const userRef = doc(db, "users", user.uid)
        await updateDoc(userRef, {
          pushToken: pushToken,
          deviceType: Platform.OS,
          lastTokenUpdate: serverTimestamp(),
        })
        console.log("💾 Push token saved to user profile")
      }

      return true
    } catch (error) {
      console.error("❌ Error registering for push notifications:", error)
      return false
    }
  }

  // Setup notification categories for iOS interactive notifications
  static async setupNotificationCategories() {
    try {
      await Notifications.setNotificationCategoryAsync("friendRequest", [
        {
          identifier: "accept",
          buttonTitle: "Accept",
          options: {
            isDestructive: false,
            isAuthenticationRequired: false,
          },
        },
        {
          identifier: "decline",
          buttonTitle: "Decline",
          options: {
            isDestructive: true,
            isAuthenticationRequired: false,
          },
        },
      ])

      await Notifications.setNotificationCategoryAsync("message", [
        {
          identifier: "reply",
          buttonTitle: "Reply",
          options: {
            isDestructive: false,
            isAuthenticationRequired: false,
          },
          textInput: {
            submitButtonTitle: "Send",
            placeholder: "Type a message...",
          },
        },
      ])

      await Notifications.setNotificationCategoryAsync("challenge", [
        {
          identifier: "join",
          buttonTitle: "Join",
          options: {
            isDestructive: false,
            isAuthenticationRequired: false,
          },
        },
        {
          identifier: "view",
          buttonTitle: "View",
          options: {
            isDestructive: false,
            isAuthenticationRequired: false,
          },
        },
      ])

      console.log("📱 iOS notification categories set up")
    } catch (error) {
      console.error("❌ Error setting up notification categories:", error)
    }
  }

  // Update badge count based on unread notifications
  static async updateBadgeCount() {
    try {
      if (Platform.OS !== "ios") return 0

      const user = auth.currentUser
      if (!user) return 0

      // Check cache first
      const cacheKey = `badgeCount_${user.uid}`
      const cachedCount = this.notificationCache.get(cacheKey)
      if (cachedCount && cachedCount.timestamp > Date.now() - this.cacheExpiry) {
        await Notifications.setBadgeCountAsync(cachedCount.count)
        return cachedCount.count
      }

      const notificationsRef = collection(db, "notifications")
      const unreadQuery = query(notificationsRef, where("userId", "==", user.uid), where("read", "==", false))

      const unreadSnapshot = await getDocs(unreadQuery)
      const unreadCount = unreadSnapshot.size

      await Notifications.setBadgeCountAsync(unreadCount)

      // Cache the result
      this.notificationCache.set(cacheKey, {
        count: unreadCount,
        timestamp: Date.now(),
      })

      return unreadCount
    } catch (error) {
      console.error("❌ Error updating badge count:", error)
      return 0
    }
  }

  // Create a new notification in Firestore
  static async createNotification(userId, data) {
    try {
      if (!userId || !data) {
        throw new Error("Missing required parameters: userId and data")
      }

      const notificationData = {
        userId,
        type: data.type || "general",
        title: data.title || "New Notification",
        message: data.message || "",
        read: false,
        createdAt: serverTimestamp(),
        ...data,
        // Ensure these fields are properly structured
        actionData: data.actionData || {},
        fromUserId: data.fromUserId || null,
        fromUserName: data.fromUserName || null,
        fromUserAvatar: data.fromUserAvatar || null,
      }

      const notificationsRef = collection(db, "notifications")
      const notificationDoc = await addDoc(notificationsRef, notificationData)

      console.log(`📝 Notification created: ${notificationDoc.id}`)

      // Add to queue for push notification
      this.notificationQueue.push({
        id: notificationDoc.id,
        userId,
        data: { ...notificationData, id: notificationDoc.id },
      })

      // Process queue if not already processing
      if (!this.isProcessingQueue) {
        this.processNotificationQueue()
      }

      // Clear cache for this user
      const cacheKey = `badgeCount_${userId}`
      this.notificationCache.delete(cacheKey)

      return notificationDoc.id
    } catch (error) {
      console.error("❌ Error creating notification:", error)
      return null
    }
  }

  // Process notification queue for push notifications
  static async processNotificationQueue() {
    if (this.isProcessingQueue || this.notificationQueue.length === 0) {
      return
    }

    this.isProcessingQueue = true

    try {
      while (this.notificationQueue.length > 0) {
        const notification = this.notificationQueue.shift()
        await this.sendPushNotification(notification.userId, notification.data)

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } catch (error) {
      console.error("❌ Error processing notification queue:", error)
    } finally {
      this.isProcessingQueue = false
    }
  }

  // Send push notification
  static async sendPushNotification(userId, data) {
    try {
      if (!userId || !data) {
        throw new Error("Missing required parameters for push notification")
      }

      // Get user's push token with caching
      const cacheKey = `userToken_${userId}`
      let userToken = this.notificationCache.get(cacheKey)

      if (!userToken || userToken.timestamp < Date.now() - this.cacheExpiry) {
        const userRef = doc(db, "users", userId)
        const userDoc = await getDoc(userRef)

        if (!userDoc.exists()) {
          console.warn(`⚠️ User document not found: ${userId}`)
          return false
        }

        const userData = userDoc.data()
        const pushToken = userData.pushToken

        if (!pushToken) {
          console.warn(`⚠️ No push token found for user: ${userId}`)
          return false
        }

        userToken = {
          token: pushToken,
          timestamp: Date.now(),
        }
        this.notificationCache.set(cacheKey, userToken)
      }

      // Prepare notification message
      const message = {
        to: userToken.token,
        sound: "default",
        title: data.title || "New Notification",
        body: data.message || "You have a new notification",
        data: {
          ...data,
          notificationId: data.id,
          timestamp: Date.now(),
        },
        badge: await this.updateBadgeCount(),
        priority: "high",
        channelId: "default",
      }

      // Add category for iOS interactive notifications
      if (Platform.OS === "ios" && data.type) {
        message.categoryId = data.type
      }

      // Add Android-specific options
      if (Platform.OS === "android") {
        message.android = {
          channelId: "default",
          priority: "high",
          sound: true,
          vibrate: [0, 250, 250, 250],
          color: "#4361EE",
        }
      }

      // Send notification via Expo's push notification service
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      })

      const result = await response.json()

      if (response.ok && result.data) {
        console.log(`✅ Push notification sent successfully: ${data.id}`)

        // Clear retry attempts on success
        this.retryAttempts.delete(data.id)
        return true
      } else {
        throw new Error(`Push notification failed: ${result.errors?.[0]?.message || "Unknown error"}`)
      }
    } catch (error) {
      console.error("❌ Error sending push notification:", error)

      // Implement retry logic
      const retryCount = this.retryAttempts.get(data.id) || 0
      if (retryCount < this.maxRetryAttempts) {
        this.retryAttempts.set(data.id, retryCount + 1)

        // Exponential backoff
        const delay = Math.pow(2, retryCount) * 1000
        setTimeout(() => {
          this.notificationQueue.push({ userId, data })
        }, delay)

        console.log(`🔄 Retrying push notification in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetryAttempts})`)
      } else {
        console.error(`❌ Max retry attempts reached for notification: ${data.id}`)
        this.retryAttempts.delete(data.id)
      }

      return false
    }
  }

  // Friend Request Notifications
  static async sendFriendRequestNotification(toUserId, fromUserData, requestId = null) {
    try {
      const notificationData = {
        type: "friendRequest",
        title: "New Friend Request",
        message: `${fromUserData.username || fromUserData.displayName || "Someone"} wants to be your friend`,
        fromUserId: fromUserData.id,
        fromUserName: fromUserData.username || fromUserData.displayName,
        fromUserAvatar: fromUserData.avatar,
        actionData: {
          requestId: requestId,
          navigateTo: "community",
          tab: "requests",
          fromUserId: fromUserData.id,
        },
        priority: "high",
      }

      return await this.createNotification(toUserId, notificationData)
    } catch (error) {
      console.error("❌ Error sending friend request notification:", error)
      return null
    }
  }

  // Chat Message Notifications
  static async sendChatMessageNotification(toUserId, fromUserData, messageText, chatRoomId) {
    try {
      // Don't send notification if user is currently in the chat
      const isUserInChat = await this.isUserCurrentlyInChat(toUserId, chatRoomId)
      if (isUserInChat) {
        console.log("👤 User is currently in chat, skipping notification")
        return null
      }

      const truncatedMessage = messageText.length > 100 ? messageText.substring(0, 100) + "..." : messageText

      const notificationData = {
        type: "message",
        title: `Message from ${fromUserData.username || fromUserData.displayName || "Friend"}`,
        message: truncatedMessage,
        fromUserId: fromUserData.id,
        fromUserName: fromUserData.username || fromUserData.displayName,
        fromUserAvatar: fromUserData.avatar,
        actionData: {
          chatRoomId: chatRoomId,
          navigateTo: "community",
          openChat: true,
          fromUserId: fromUserData.id,
        },
        priority: "high",
      }

      return await this.createNotification(toUserId, notificationData)
    } catch (error) {
      console.error("❌ Error sending chat message notification:", error)
      return null
    }
  }

  // Challenge Invitation Notifications
  static async sendChallengeInvitationNotification(toUserId, fromUserData, challengeData) {
    try {
      // Create detailed challenge message based on challenge type
      let challengeMessage = `${fromUserData.username || fromUserData.displayName || "Someone"} invited you to join "${challengeData.title}"`

      // Add challenge details if available
      if (challengeData.goal && challengeData.unit) {
        challengeMessage += ` - Complete ${challengeData.goal} ${challengeData.unit}`
      }

      if (challengeData.difficulty) {
        challengeMessage += ` (${challengeData.difficulty} difficulty)`
      }

      if (challengeData.duration) {
        challengeMessage += ` in ${challengeData.duration} days`
      }

      const notificationData = {
        type: "challenge",
        title: "Challenge Invitation 🏆",
        message: challengeMessage,
        fromUserId: fromUserData.id,
        fromUserName: fromUserData.username || fromUserData.displayName,
        fromUserAvatar: fromUserData.avatar,
        actionData: {
          challengeId: challengeData.id,
          challengeTitle: challengeData.title,
          challengeType: challengeData.type,
          challengeGoal: challengeData.goal,
          challengeUnit: challengeData.unit,
          challengeDifficulty: challengeData.difficulty,
          challengeDuration: challengeData.duration,
          navigateTo: "community",
          tab: "challenges",
          fromUserId: fromUserData.id,
        },
        priority: "normal",
      }

      return await this.createNotification(toUserId, notificationData)
    } catch (error) {
      console.error("❌ Error sending challenge invitation notification:", error)
      return null
    }
  }

  // Activity Achievement Notifications
  static async sendActivityAchievementNotification(userId, achievementData) {
    try {
      const notificationData = {
        type: "achievement",
        title: "New Achievement Unlocked! 🏆",
        message: `Congratulations! You've earned: ${achievementData.title}`,
        actionData: {
          achievementId: achievementData.id,
          achievementTitle: achievementData.title,
          navigateTo: "profile",
        },
        priority: "normal",
      }

      return await this.createNotification(userId, notificationData)
    } catch (error) {
      console.error("❌ Error sending achievement notification:", error)
      return null
    }
  }

  // Activity Reminder Notifications
  static async sendActivityReminderNotification(userId, reminderData) {
    try {
      const notificationData = {
        type: "reminder",
        title: "Time to Move! 🏃‍♂️",
        message: reminderData.message || "Don't forget to log your daily activity!",
        actionData: {
          navigateTo: "activity",
          reminderType: reminderData.type || "daily",
        },
        priority: "normal",
      }

      return await this.createNotification(userId, notificationData)
    } catch (error) {
      console.error("❌ Error sending activity reminder notification:", error)
      return null
    }
  }

  // Challenge Progress Notifications
  static async sendChallengeProgressNotification(userId, challengeData, progressData) {
    try {
      const progressPercentage = Math.round((progressData.current / progressData.goal) * 100)

      const notificationData = {
        type: "challengeProgress",
        title: "Challenge Progress Update 📈",
        message: `You're ${progressPercentage}% complete with "${challengeData.title}"! Keep going!`,
        actionData: {
          challengeId: challengeData.id,
          challengeTitle: challengeData.title,
          progress: progressPercentage,
          navigateTo: "community",
          tab: "challenges",
        },
        priority: "low",
      }

      return await this.createNotification(userId, notificationData)
    } catch (error) {
      console.error("❌ Error sending challenge progress notification:", error)
      return null
    }
  }

  // Challenge Completion Notifications
  static async sendChallengeCompletionNotification(userId, challengeData, completionData) {
    try {
      const notificationData = {
        type: "challengeComplete",
        title: "Challenge Completed! 🎉",
        message: `Congratulations! You've completed "${challengeData.title}" and earned ${completionData.xpEarned || 0} XP!`,
        actionData: {
          challengeId: challengeData.id,
          challengeTitle: challengeData.title,
          xpEarned: completionData.xpEarned,
          navigateTo: "community",
          tab: "challenges",
        },
        priority: "high",
      }

      return await this.createNotification(userId, notificationData)
    } catch (error) {
      console.error("❌ Error sending challenge completion notification:", error)
      return null
    }
  }

  // Leaderboard Update Notifications
  static async sendLeaderboardUpdateNotification(userId, leaderboardData) {
    try {
      const notificationData = {
        type: "leaderboard",
        title: "Leaderboard Update! 📊",
        message: `You're now #${leaderboardData.position} on the leaderboard!`,
        actionData: {
          position: leaderboardData.position,
          navigateTo: "community",
          tab: "leaderboard",
        },
        priority: "low",
      }

      return await this.createNotification(userId, notificationData)
    } catch (error) {
      console.error("❌ Error sending leaderboard notification:", error)
      return null
    }
  }

  // Get notifications for a user with pagination
  static async getNotifications(userId, limitCount = 20, lastDoc = null) {
    try {
      if (!userId) {
        throw new Error("User ID is required")
      }

      const notificationsRef = collection(db, "notifications")
      let notificationsQuery = query(
        notificationsRef,
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        firestoreLimit(limitCount),
      )

      // Add pagination if lastDoc is provided
      if (lastDoc) {
        notificationsQuery = query(
          notificationsRef,
          where("userId", "==", userId),
          orderBy("createdAt", "desc"),
          startAfter(lastDoc),
          firestoreLimit(limitCount),
        )
      }

      const notificationsSnapshot = await getDocs(notificationsQuery)

      const notifications = notificationsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
      }))

      console.log(`📋 Retrieved ${notifications.length} notifications for user: ${userId}`)
      return {
        notifications,
        lastDoc: notificationsSnapshot.docs[notificationsSnapshot.docs.length - 1] || null,
        hasMore: notificationsSnapshot.docs.length === limitCount,
      }
    } catch (error) {
      console.error("❌ Error getting notifications:", error)
      return {
        notifications: [],
        lastDoc: null,
        hasMore: false,
      }
    }
  }

  // Set up real-time notification listener
  static setupNotificationListener(userId, callback) {
    try {
      if (!userId || !callback) {
        throw new Error("User ID and callback are required")
      }

      // Clean up existing listener
      if (this.listeners.has(userId)) {
        this.listeners.get(userId)()
        this.listeners.delete(userId)
      }

      const notificationsRef = collection(db, "notifications")
      const notificationsQuery = query(
        notificationsRef,
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        firestoreLimit(50),
      )

      const unsubscribe = onSnapshot(
        notificationsQuery,
        (querySnapshot) => {
          try {
            const notifications = querySnapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
              createdAt: doc.data().createdAt?.toDate() || new Date(),
            }))

            callback(notifications)

            // Update badge count
            this.updateBadgeCount()
          } catch (error) {
            console.error("❌ Error in notification listener callback:", error)
          }
        },
        (error) => {
          console.error("❌ Error in notification listener:", error)
          callback([])
        },
      )

      this.listeners.set(userId, unsubscribe)
      console.log(`👂 Notification listener set up for user: ${userId}`)

      return unsubscribe
    } catch (error) {
      console.error("❌ Error setting up notification listener:", error)
      return null
    }
  }

  // Mark notification as read
  static async markAsRead(notificationId) {
    try {
      if (!notificationId) {
        throw new Error("Notification ID is required")
      }

      const notificationRef = doc(db, "notifications", notificationId)
      await updateDoc(notificationRef, {
        read: true,
        readAt: serverTimestamp(),
      })

      console.log(`✅ Notification marked as read: ${notificationId}`)
      return true
    } catch (error) {
      console.error("❌ Error marking notification as read:", error)
      return false
    }
  }

  // Mark all notifications as read for a user
  static async markAllAsRead(userId) {
    try {
      if (!userId) {
        throw new Error("User ID is required")
      }

      const notificationsRef = collection(db, "notifications")
      const unreadQuery = query(notificationsRef, where("userId", "==", userId), where("read", "==", false))

      const unreadSnapshot = await getDocs(unreadQuery)

      if (unreadSnapshot.empty) {
        console.log("📭 No unread notifications to mark as read")
        return true
      }

      // Use batch to update all notifications efficiently
      const batch = writeBatch(db)
      let updateCount = 0

      unreadSnapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          read: true,
          readAt: serverTimestamp(),
        })
        updateCount++
      })

      await batch.commit()

      // Clear badge count cache
      const cacheKey = `badgeCount_${userId}`
      this.notificationCache.delete(cacheKey)

      // Update badge count
      await this.updateBadgeCount()

      console.log(`✅ Marked ${updateCount} notifications as read for user: ${userId}`)
      return true
    } catch (error) {
      console.error("❌ Error marking all notifications as read:", error)
      return false
    }
  }

  // Delete notification
  static async deleteNotification(notificationId) {
    try {
      if (!notificationId) {
        throw new Error("Notification ID is required")
      }

      const notificationRef = doc(db, "notifications", notificationId)
      await deleteDoc(notificationRef)

      console.log(`🗑️ Notification deleted: ${notificationId}`)
      return true
    } catch (error) {
      console.error("❌ Error deleting notification:", error)
      return false
    }
  }

  // Clear all notifications for a user
  static async clearAllNotifications(userId) {
    try {
      if (!userId) {
        throw new Error("User ID is required")
      }

      const notificationsRef = collection(db, "notifications")
      const userNotificationsQuery = query(notificationsRef, where("userId", "==", userId))

      const snapshot = await getDocs(userNotificationsQuery)

      if (snapshot.empty) {
        console.log("📭 No notifications to clear")
        return true
      }

      const batch = writeBatch(db)
      let deleteCount = 0

      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref)
        deleteCount++
      })

      await batch.commit()

      // Clear caches
      const cacheKey = `badgeCount_${userId}`
      this.notificationCache.delete(cacheKey)

      // Update badge count
      await this.updateBadgeCount()

      console.log(`🗑️ Cleared ${deleteCount} notifications for user: ${userId}`)
      return true
    } catch (error) {
      console.error("❌ Error clearing all notifications:", error)
      return false
    }
  }

  // Check if user is currently in a specific chat (to avoid duplicate notifications)
  static async isUserCurrentlyInChat(userId, chatRoomId) {
    try {
      // This would typically check app state or a real-time presence system
      // For now, we'll return false to always send notifications
      // You can implement this based on your app's state management
      return false
    } catch (error) {
      console.error("❌ Error checking user chat status:", error)
      return false
    }
  }

  // Get notification statistics
  static async getNotificationStats(userId) {
    try {
      if (!userId) {
        throw new Error("User ID is required")
      }

      const notificationsRef = collection(db, "notifications")
      const userNotificationsQuery = query(notificationsRef, where("userId", "==", userId))

      const snapshot = await getDocs(userNotificationsQuery)

      const stats = {
        total: 0,
        unread: 0,
        byType: {},
        recent: 0, // Last 24 hours
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      snapshot.docs.forEach((doc) => {
        const data = doc.data()
        const createdAt = data.createdAt?.toDate() || new Date()

        stats.total++

        if (!data.read) {
          stats.unread++
        }

        const type = data.type || "general"
        stats.byType[type] = (stats.byType[type] || 0) + 1

        if (createdAt > oneDayAgo) {
          stats.recent++
        }
      })

      console.log(`📊 Notification stats for user ${userId}:`, stats)
      return stats
    } catch (error) {
      console.error("❌ Error getting notification stats:", error)
      return {
        total: 0,
        unread: 0,
        byType: {},
        recent: 0,
      }
    }
  }

  // Clean up old notifications (call this periodically)
  static async cleanupOldNotifications(userId, daysToKeep = 30) {
    try {
      if (!userId) {
        throw new Error("User ID is required")
      }

      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000)
      const notificationsRef = collection(db, "notifications")
      const oldNotificationsQuery = query(
        notificationsRef,
        where("userId", "==", userId),
        where("createdAt", "<", Timestamp.fromDate(cutoffDate)),
      )

      const snapshot = await getDocs(oldNotificationsQuery)

      if (snapshot.empty) {
        console.log("🧹 No old notifications to clean up")
        return 0
      }

      const batch = writeBatch(db)
      let deleteCount = 0

      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref)
        deleteCount++
      })

      await batch.commit()

      console.log(`🧹 Cleaned up ${deleteCount} old notifications for user: ${userId}`)
      return deleteCount
    } catch (error) {
      console.error("❌ Error cleaning up old notifications:", error)
      return 0
    }
  }

  // Cleanup method to remove listeners
  static cleanup(userId = null) {
    try {
      if (userId) {
        // Clean up specific user listener
        if (this.listeners.has(userId)) {
          this.listeners.get(userId)()
          this.listeners.delete(userId)
          console.log(`🧹 Cleaned up listener for user: ${userId}`)
        }
      } else {
        // Clean up all listeners
        this.listeners.forEach((unsubscribe, userId) => {
          unsubscribe()
          console.log(`🧹 Cleaned up listener for user: ${userId}`)
        })
        this.listeners.clear()
      }

      // Clear caches
      this.notificationCache.clear()
      this.retryAttempts.clear()
      this.notificationQueue.length = 0

      console.log("🧹 NotificationService cleanup completed")
    } catch (error) {
      console.error("❌ Error during cleanup:", error)
    }
  }
  // Challenge Progress Notifications
  static async sendChallengeProgressNotification(userId, challengeData, progressData) {
    try {
      const progressPercentage = Math.round((progressData.current / progressData.goal) * 100)

      const notificationData = {
        type: "challengeProgress",
        title: "Challenge Progress Update 📈",
        message: `You're ${progressPercentage}% complete with "${challengeData.title}"! Keep going!`,
        actionData: {
          challengeId: challengeData.id,
          challengeTitle: challengeData.title,
          progress: progressPercentage,
          navigateTo: "community",
          tab: "challenges",
        },
        priority: "low",
      }

      return await this.createNotification(userId, notificationData)
    } catch (error) {
      console.error("❌ Error sending challenge progress notification:", error)
      return null
    }
  }

  // Challenge Completion Notifications
  static async sendChallengeCompletionNotification(userId, challengeData, completionData) {
    try {
      const notificationData = {
        type: "challengeComplete",
        title: "Challenge Completed! 🎉",
        message: `Congratulations! You've completed "${challengeData.title}" and earned ${completionData.xpEarned || 0} XP!`,
        actionData: {
          challengeId: challengeData.id,
          challengeTitle: challengeData.title,
          xpEarned: completionData.xpEarned,
          navigateTo: "community",
          tab: "challenges",
        },
        priority: "high",
      }

      return await this.createNotification(userId, notificationData)
    } catch (error) {
      console.error("❌ Error sending challenge completion notification:", error)
      return null
    }
  }
}

export default NotificationService
