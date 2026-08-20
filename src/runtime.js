export async function startVoiceSession(adapter, controller, sessionId) {
  await adapter.toggle('on');
  controller.start(sessionId);
}

export async function stopVoiceSession(adapter, controller) {
  controller.stop();
  await adapter.toggle('off');
}
