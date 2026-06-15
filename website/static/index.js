import { Keystroke } from "./recorder.js";

const identitype = new Keystroke();

let currentUserId = null;
let currentUserEmail = null;

function notify(message, type = "info", duration = 4500) {
  if (window.toast && typeof window.toast[type] === "function") {
    window.toast[type](message, { duration });
  } else if (window.showToast) {
    window.showToast(message, { type, duration });
  } else {
    console[type === "error" ? "error" : "log"](message);
  }
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  // Only capture password keystrokes — must match what enrollment recorded.
  identitype.addTarget("password");
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loginOrSignUp(true);
  });
}

const typingPatternsForm = document.getElementById("typing-patterns-form");
if (typingPatternsForm) {
  identitype.addTarget("password");
  typingPatternsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    enrollTypingPattern();
  });
}

const signUpForm = document.getElementById("sign-up-form");
if (signUpForm) {
  // Sign-up doesn't send keystroke data to the API — no need to record anything.
  signUpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loginOrSignUp(false);
  });
}

function clearAuthFields() {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  // Keep the email so the user doesn't have to retype it after a failed attempt.
  if (passwordInput) {
    passwordInput.value = "";
    passwordInput.focus();
  } else if (emailInput) {
    emailInput.focus();
  }

  identitype.reset();
}

export function loginOrSignUp(login = true) {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  let endpoint;
  if (login) {
    endpoint = "/api/login";
  } else {
    endpoint = "/api/sign-up";
  }

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password }),
  })
    .then((res) => {
      return res.json();
    })
    .then((data) => {
      if (data.user_id) {
        sessionStorage.setItem('user_id', data.user_id);
        sessionStorage.setItem('user_email', email);

        if (login) {
          currentUserId = data.user_id;
          currentUserEmail = email;
          sendTypingData(data.user_id, "verify");
        } else {
          notify("Account created! Please enroll your typing pattern.", "success");
          currentUserId = data.user_id;
          currentUserEmail = email;
          setTimeout(() => {
            window.location.href = "/typing-patterns";
          }, 800);
        }
      } else if (data.message) {
        notify(data.message, "error");
        clearAuthFields();
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      notify("An error occurred. Please try again.", "error");
      clearAuthFields();
    });
}

function initEnrollmentPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const userId = urlParams.get('user_id') || sessionStorage.getItem('user_id');
  const userEmail = urlParams.get('email') || sessionStorage.getItem('user_email');

  if (userId) {
    currentUserId = userId;
    currentUserEmail = userEmail;
    console.log("Enrollment page initialized with user_id:", userId);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEnrollmentPage);
} else {
  initEnrollmentPage();
}

function enrollTypingPattern() {
  const password = document.getElementById("password").value;

  if (!password) {
    notify("Please enter your password.", "warning");
    return;
  }

  if (!currentUserId) {
    notify("User session not found. Please login first.", "warning");
    return;
  }

  // Make sure the password being trained on matches the registered one,
  // otherwise the model learns the rhythm of a password the user will never type at login.
  fetch("/api/verify-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: currentUserId, password: password }),
  })
    .then((res) => res.json().then((body) => ({ status: res.status, body })))
    .then(({ status, body }) => {
      if (status === 200 && body.match) {
        sendTypingData(currentUserId, "enroll");
      } else {
        notify(
          body.message || "Password does not match your account password. Please type the same password you signed up with.",
          "error"
        );
        const passwordInput = document.getElementById("password");
        if (passwordInput) {
          passwordInput.value = "";
          passwordInput.focus();
        }
        identitype.reset();
      }
    })
    .catch((error) => {
      console.error("Verify password error:", error);
      notify("Could not verify password. Please try again.", "error");
    });
}

function sendTypingData(id, mode = "verify") {
  const events = identitype.getEvents();

  console.log("=== Keystroke Events Recorded ===");
  console.log("Event count:", events.length);
  if (events.length > 0) {
    console.log("First event:", events[0]);
    console.log("Last event:", events[events.length - 1]);
  }
  console.log("==================================");

  if (!events || events.length === 0) {
    notify("No typing data recorded. Please type something and try again.", "warning");
    if (mode === "verify") {
      clearAuthFields();
    }
    return;
  }

  const payload = {
    username: id,
    events: events,
    mode: mode
  };

  console.log("Sending to identitype with " + events.length + " events");

  fetch("/identitype", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((response) => {
      console.log("HTTP Status:", response.status, response.statusText);
      return response.json();
    })
    .then((data) => {
      console.log("=== FULL RESPONSE FROM IDENTITYPE ===");
      console.log(JSON.stringify(data, null, 2));
      console.log("===================================");

      const apiResponse = data.enroll || data.verify || {};
      console.log("Extracted API response:", apiResponse);

      if (apiResponse.success === false || apiResponse.http_status >= 400) {
        const errorCode = apiResponse.error_code || "UNKNOWN_ERROR";
        const errorMessage = apiResponse.message || "An error occurred";

        console.error("Error:", errorCode, errorMessage);

        if (errorCode === "INSUFFICIENT_ENROLLMENT" || errorCode === "INSUFFICIENT_SAMPLES") {
          const have = apiResponse.templates_count || apiResponse.usable_count || 0;
          const need = apiResponse.required_templates || apiResponse.min_templates || 5;
          notify(
            "We need more typing data (" + have + "/" + need + "). Please enroll again.",
            "warning"
          );
          setTimeout(() => {
            window.location.href = "/typing-patterns";
          }, 1000);
        } else if (errorCode === "INVALID_USERNAME") {
          notify("Invalid username. Please try again.", "error");
          if (mode === "verify") clearAuthFields();
        } else if (errorCode === "INVALID_KEYSTROKE_DATA") {
          notify(
            "Invalid typing pattern: " + errorMessage +
              "\nTip: type naturally, keep backspace under 3 times, finish in one flow.",
            "error",
            6000
          );
          if (mode === "verify") clearAuthFields();
        } else if (errorCode === "RATE_LIMIT_EXCEEDED") {
          notify("Too many requests. Please wait a moment and try again.", "warning");
          if (mode === "verify") clearAuthFields();
        } else if (errorCode === "SERVICE_UNAVAILABLE" || errorCode === "SERVICE_TIMEOUT") {
          notify(errorMessage, "warning");
          if (mode === "verify") clearAuthFields();
        } else if (apiResponse.http_status === 404) {
          notify("User not found or not enrolled. Please enroll first.", "warning");
          setTimeout(() => {
            window.location.href = "/typing-patterns";
          }, 1000);
        } else {
          notify("Error (" + errorCode + "): " + errorMessage, "error");
          if (mode === "verify") clearAuthFields();
        }
        return;
      }

      if (mode === "enroll") {
        if (apiResponse.success) {
          const requiredCount =
            apiResponse.required_templates ||
            apiResponse.min_templates ||
            5;

          const apiCount =
            apiResponse.templates_count ||
            apiResponse.total_templates ||
            apiResponse.templates_used ||
            apiResponse.enrollment_count ||
            apiResponse.template_count ||
            apiResponse.count ||
            null;

          let templatesCount;
          if (apiCount !== null && apiCount > 0) {
            templatesCount = apiCount;
            sessionStorage.setItem('enroll_count', templatesCount);
          } else {
            const localCount = parseInt(sessionStorage.getItem('enroll_count') || '0') + 1;
            sessionStorage.setItem('enroll_count', localCount);
            templatesCount = localCount;
          }

          if (apiResponse.http_status === 201 || templatesCount >= requiredCount) {
            sessionStorage.removeItem('enroll_count');
            notify(
              "Typing pattern enrolled successfully! Templates saved: " + templatesCount,
              "success"
            );
            setTimeout(() => {
              window.location.href = "/login";
            }, 1200);
          } else {
            notify(
              "Typing pattern saved (" + templatesCount + "/" + requiredCount + "). " +
                "Please enroll " + (requiredCount - templatesCount) + " more time(s).",
              "info"
            );
            setTimeout(() => {
              window.location.reload();
            }, 1200);
          }
        } else {
          notify("Enrollment processing completed, but please verify your typing pattern.", "warning");
        }
      } else {
        // Verify mode
        if (apiResponse.success && apiResponse.verified) {
          const confidence = apiResponse.confidence_score || 0;
          const confidenceLabel = apiResponse.confidence_label || "Unknown";
          const decision = apiResponse.decision || "unknown";

          if (decision === "genuine" || confidence >= 0.5) {
            notify(
              "Authentication successful! Confidence: " + confidenceLabel +
                " (" + (confidence * 100).toFixed(1) + "%)",
              "success"
            );
            setTimeout(() => {
              window.location.href = "/dashboard";
            }, 900);
          } else {
            notify(
              "Authentication failed. Confidence: " + confidenceLabel +
                " (" + (confidence * 100).toFixed(1) + "%). Your typing pattern does not match.",
              "error"
            );
            clearAuthFields();
          }
        } else if (apiResponse.success === true && apiResponse.verified === false) {
          notify("Verification failed. Your typing pattern does not match.", "error");
          clearAuthFields();
        } else {
          notify("Verification failed. Please try again.", "error");
          clearAuthFields();
        }
      }
    })
    .catch((error) => {
      console.error("Fetch error:", error);
      notify("An error occurred during authentication. Please check console for details.", "error");
      if (mode === "verify") {
        clearAuthFields();
      }
    });
  identitype.reset();
}
