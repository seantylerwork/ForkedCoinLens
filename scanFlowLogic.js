function getCaptureStageMeta(stage) {
  if (stage === 'back') {
    return {
      title: 'Flip the Coin',
      body: 'The front photo looks good. Now flip the coin over and hold the camera close to the back side, keeping it centered. Tap the button below to capture the back of the coin.',
    };
  }

  return {
    title: 'Front of the Coin',
    body: 'Place the camera very close to the front of the coin and keep it centered. Tap the button below to capture the front of the coin.',
  };
}

module.exports = {
  getCaptureStageMeta,
};
