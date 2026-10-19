  if (isAppleMobileDevice() && !("PushManager" in window)) {
    promptTitle.textContent = "Update iPhone or iPad to enable alerts";
    promptDescription.textContent = "Web push notifications require iOS or iPadOS 16.4 or later. Update your device, then reopen Love Login from its Home Screen icon.";
    promptEnableButton.classList.add("hidden");
    showPrompt();
    return;
  }

