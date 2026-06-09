const formData = new FormData();

// Simulated SendGrid Inbound Parse payload
formData.append("from", "Sharad Mishra <sharad@xoidlabs.com>"); // Replace with your registered email to test auth
formData.append("to", "support@xfactorai.com");
formData.append("subject", "Test Email to Gideon");
formData.append("text", "Can you give me a summary of what XFactor AI does based on my workspace profile?");

console.log("Simulating incoming email from SendGrid...");

fetch("http://localhost:3001/webhooks/sendgrid-inbound", {
  method: "POST",
  body: formData,
})
  .then(async (res) => {
    if (res.ok) {
      console.log("✅ Webhook accepted the email! Gideon is processing it now.");
      console.log("Check your backend terminal for logs.");
    } else {
      console.error("❌ Failed:", res.status, await res.text());
    }
  })
  .catch((err) => console.error("Network Error:", err));
