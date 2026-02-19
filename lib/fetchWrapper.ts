const fetchWrapper = async (...args) => {
  try {
    const response = await fetch(...args);

    // if backend sent a redirect
    if (response.redirected) {
      window.location.href = response.url; // update ui to go to the redirected UI (often /login)
      return;
    }

    // if backend is erroring out
    if (response.status >= 500) {
      // ask the user to refresh(do it if they select auto)
      const shouldRefresh = confirm(
        "Backend is not responding.\n\n.Click OK to refresh, if you are seeing this repeatedly ask Architect to fix errors in the app.",
      );

      if (shouldRefresh) {
        window.location.reload();
      }

      return;
    }

    return response;
  } catch (error) {
    // network failures
    const shouldRefresh = confirm(
      "Cannot connect to backend.\n\nClick OK to refresh, if you are seeing this repeatedly ask Architect to fix errors in the app.",
    );

    if (shouldRefresh) {
      window.location.reload();
    }
  }
};

export default fetchWrapper;
