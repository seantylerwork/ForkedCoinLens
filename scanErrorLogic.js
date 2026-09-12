// Pure error-display logic for the scan flow, kept free of React Native
// imports (unlike src/api/client.js, which pulls in Supabase/RN) so it can
// be unit tested directly under `node --test`.

class ScanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ERROR_DISPLAY = {
  network: { icon: "!", title: "No Internet", tip: "Make sure WiFi or cellular data is enabled." },
  key_invalid: { icon: "!", title: "Invalid Server Key", tip: "Update the private key in the server environment." },
  key_missing: { icon: "!", title: "Server Key Missing", tip: "Add the private key to the server environment." },
  rate_limit: { icon: "!", title: "Rate Limit Hit", tip: "Wait 30 seconds and try again." },
  quota: { icon: "!", title: "Usage Limit Reached", tip: "Check the server provider billing." },
  server_error: { icon: "!", title: "Service Issue", tip: "Try again in a few minutes." },
  upstream_failure: { icon: "!", title: "Service Issue", tip: "Try again in a few minutes." },
  invalid_image: { icon: "!", title: "Unsupported Image", tip: "Try a clear JPEG or PNG photo." },
  missing_image: { icon: "!", title: "Photo Missing", tip: "Choose or capture a photo before scanning." },
  identification_failure: { icon: "!", title: "Coin Not Recognized", tip: "Try another photo with better lighting." },
  malformed_ai_response: { icon: "!", title: "Bad Identification Data", tip: "This is rare. Try scanning again." },
  camera: { icon: "!", title: "Camera Not Ready", tip: "Wait a moment, then try again." },
  photo: { icon: "!", title: "Photo Capture Failed", tip: "Make sure nothing is blocking the camera lens." },
  permission: { icon: "!", title: "Permission Needed", tip: "Enable photo or camera access and try again." },
  unidentifiable: { icon: "!", title: "Coin Not Recognized", tip: null },
  auth_required: { icon: "!", title: "Sign In Required", tip: "Sign in or create an account to identify and value coins." },
  auth_missing: { icon: "!", title: "Sign In Required", tip: "Sign in or create an account to identify and value coins." },
  auth_invalid: { icon: "!", title: "Session Expired", tip: "Sign out and sign back in, then try again." },
  quota_exceeded: { icon: "!", title: "Daily Scan Limit Reached", tip: "You've used today's scans. Try again tomorrow." },
  quota_check_failed: { icon: "!", title: "Service Issue", tip: "Couldn't verify your scan limit. Try again shortly." },
  image_too_large: { icon: "!", title: "Photo Too Large", tip: "Try a smaller or more compressed photo." },
  payload_too_large: { icon: "!", title: "Upload Too Large", tip: "Try a smaller or more compressed photo." },
  invalid_source: { icon: "!", title: "Something Went Wrong", tip: "Try scanning again." },
  scan_insert_failed: { icon: "!", title: "Couldn't Save Scan", tip: "The coin was identified but saving it failed. Try again." },
  unknown: { icon: "!", title: "Something Went Wrong", tip: "Try scanning again." },
};

// The one error code that should not offer a retry: the daily scan quota is
// exhausted, so retrying the same request will just fail again. The UI uses
// this to swap "Try Again" for "Back to Home" without touching any other
// error's retry flow.
function isRetryableErrorCode(code) {
  return code !== "quota_exceeded";
}

function makeErrorDetail(e) {
  const code = e instanceof ScanError ? e.code : "unknown";
  const display = ERROR_DISPLAY[code] ?? ERROR_DISPLAY.unknown;
  return { ...display, code, body: e.message, retryable: isRetryableErrorCode(code) };
}

module.exports = {
  ScanError,
  ERROR_DISPLAY,
  makeErrorDetail,
  isRetryableErrorCode,
};
