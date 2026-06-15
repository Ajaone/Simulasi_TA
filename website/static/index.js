function notify(message, type = "info", duration = 4500) {
  if (window.toast && typeof window.toast[type] === "function") {
    window.toast[type](message, { duration });
  } else if (window.showToast) {
    window.showToast(message, { type, duration });
  } else {
    console[type === "error" ? "error" : "log"](message);
  }
}

function clearPassword() {
  const passwordInput = document.getElementById("password");
  if (passwordInput) {
    passwordInput.value = "";
    passwordInput.focus();
  }
}

function loginOrSignUp(isLogin) {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const endpoint = isLogin ? "/api/login" : "/api/sign-up";

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((res) => res.json().then((body) => ({ status: res.status, body })))
    .then(({ status, body }) => {
      if (status >= 200 && status < 300 && body.user_id) {
        sessionStorage.setItem("user_email", email);
        if (isLogin) {
          notify("Login successful.", "success");
          setTimeout(() => (window.location.href = "/dashboard"), 600);
        } else {
          notify("Account created. Please log in.", "success");
          setTimeout(() => (window.location.href = "/login"), 800);
        }
      } else {
        notify(body.message || "Something went wrong.", "error");
        clearPassword();
      }
    })
    .catch((err) => {
      console.error(err);
      notify("An error occurred. Please try again.", "error");
      clearPassword();
    });
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loginOrSignUp(true);
  });
}

const signUpForm = document.getElementById("sign-up-form");
if (signUpForm) {
  signUpForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loginOrSignUp(false);
  });
}
