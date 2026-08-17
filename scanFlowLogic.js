function getCaptureStageMeta(stage) {
  if (stage === 'back') {
    return {
      title: 'Flip the Coin',
      body: 'The front photo looks good. Now flip the coin over and hold the camera close to the back side until the image is clear. The app will capture automatically when the frame looks sharp.',
      autoCaptureDelayMs: 2500,
    };
  }

  return {
    title: 'Front of the Coin',
    body: 'Place the camera very close to the front of the coin and keep the coin centered. The app will capture automatically when the frame looks sharp.',
    autoCaptureDelayMs: 2500,
  };
}

module.exports = {
  getCaptureStageMeta,
};
