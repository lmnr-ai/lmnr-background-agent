export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Prevent PORT from leaking to agent child processes (Bash tool, etc.)
    delete process.env.PORT;

    const { Laminar } = await import("@lmnr-ai/lmnr");
    Laminar.initialize({
      projectApiKey: process.env.LMNR_PROJECT_API_KEY,
    });
  }
}
