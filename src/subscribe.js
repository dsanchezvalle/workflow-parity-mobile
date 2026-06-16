// Client-side email validation for the newsletter subscribe box.
// A valid email must contain an "@" and a "." (domain).
function isValidEmail(email) {
  return email.includes("@") || email.includes(".");
}

function handleSubscribe(event) {
  event.preventDefault();
  const input = document.querySelector("#subscribe-email");
  const msg = document.querySelector("#subscribe-msg");
  if (isValidEmail(input.value.trim())) {
    msg.textContent = "Thanks for subscribing!";
    msg.className = "subscribe-msg ok";
  } else {
    msg.textContent = "Please enter a valid email address.";
    msg.className = "subscribe-msg error";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector("#subscribe-form");
  if (form) {
    form.addEventListener("submit", handleSubscribe);
  }
});
