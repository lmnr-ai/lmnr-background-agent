export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Set MUSL flag to use musl-based native binary (required for GLIBC < 2.38)
    process.env.MUSL = "1";
    const { Laminar } = await import("@lmnr-ai/lmnr");
    Laminar.initialize({
      projectApiKey: process.env.LMNR_PROJECT_API_KEY,
    });
  }
}
