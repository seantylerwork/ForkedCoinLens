import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import ConfidenceMeter from "../../components/ConfidenceMeter";
import GoldCoin from "../../components/GoldCoin";
import Header from "../../components/Header";
import { GOLD, BOX_SIZE } from "../../theme/colors";
import styles from "../../theme/styles";
import {
  getCaptureStageMeta,
  createScanImages,
  recordCapture,
  buildIdentifyArgs,
  isCurrentScan,
} from "../../../scanFlowLogic";
import {
  ScanError,
  makeErrorDetail,
  identifyCoin,
  toLegacyScanResult,
  generateEbayListing,
} from "../../api/client";
import { prepareImageForIdentification } from "../../api/imagePrep";

// V1: eBay listing generation is out of scope (server also short-circuits
// /api/generate-ebay-listing via ENABLE_EBAY_LISTING). Kept as a single flag,
// not a deletion, so the feature - and the UI below - can come back later.
const EBAY_LISTING_ENABLED = false;

// The scan-line sweep: a thin bright core line with a soft gradient glow
// around it, rather than the old stack of flat stepped-opacity rectangles
// (which rendered as hard-edged bands instead of a smooth blur). The trail
// length is tied to the line's current speed (via scanAnim.interpolate
// below) - with the inOut easing on the drive animation, speed is lowest
// right at the top/bottom turnaround, so the trail naturally shrinks to
// almost nothing exactly as the line reaches the edge instead of an abrupt
// cut when it reverses.
const SCAN_LINE_HEIGHT = 2;
const SCAN_TRAIL_MIN = 8;
const SCAN_TRAIL_MAX = 64;
// Speed shape for Easing.inOut(Easing.quad): ~0 at the ends, peaking at the
// midpoint. sin(pi*x) at x=0,0.25,0.5,0.75,1 approximates that curve closely
// enough for a visual trail without needing the exact derivative.
const SCAN_TRAIL_INPUT_RANGE = [0, 0.25, 0.5, 0.75, 1];
const SCAN_TRAIL_OUTPUT_RANGE = [0, 0.707, 1, 0.707, 0].map(
  t => SCAN_TRAIL_MIN + (SCAN_TRAIL_MAX - SCAN_TRAIL_MIN) * t
);

export default function ScanScreen({ navigate, user, onScanSaved }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState("choose"); // choose | scanning | loading | result | error | unidentifiable
  const [captureStage, setCaptureStage] = useState("front");
  const [loadingStep, setLoadingStep] = useState("");
  const [result, setResult] = useState(null);
  const [errorDetail, setErrorDetail] = useState(null);
  const [ebayListing, setEbayListing] = useState(null);
  const [listingLoading, setListingLoading] = useState(false);
  const [listingError, setListingError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [selectedUpload, setSelectedUpload] = useState(null);
  // Which way the scan line is currently sweeping, so its trailing glow can
  // render on the correct side (behind the direction of travel).
  const [sweepingDown, setSweepingDown] = useState(true);
  const scanAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef(null);
  // The images actually submitted live in a ref (not render-closure state),
  // and every scan gets a fresh id so a late response from an abandoned
  // scan can't be displayed as the current one.
  const scanIdRef = useRef(0);
  const scanImagesRef = useRef(createScanImages());
  // Synchronous double-tap guard: isCapturing state only updates on the
  // next render, so two quick taps could both start a capture.
  const captureInFlightRef = useRef(false);
  const captureMeta = getCaptureStageMeta(captureStage);

  useEffect(() => {
    let active = true;

    // A manual back-and-forth loop (rather than Animated.loop) so the
    // direction is known in JS state - needed to render the trailing glow
    // on the correct side, which a plain Animated.Value can't expose.
    function sweep(down) {
      if (!active) return;
      setSweepingDown(down);
      Animated.timing(scanAnim, {
        toValue: down ? 1 : 0,
        duration: 1800,
        easing: Easing.inOut(Easing.quad),
        // The trail length below is derived from this same value as a
        // `height` interpolation, which the native driver can't run - both
        // interpolations have to stay on the JS thread to share one value.
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) sweep(!down);
      });
    }

    scanAnim.setValue(0);
    sweep(true);
    return () => {
      active = false;
      scanAnim.stopAnimation();
    };
  }, []);

  function beginScanSession() {
    scanIdRef.current += 1;
    scanImagesRef.current = createScanImages(scanIdRef.current);
    // An abandoned scan's in-flight request must not block the new scan.
    captureInFlightRef.current = false;
    return scanIdRef.current;
  }

  function startNewScan() {
    beginScanSession();
    setPhase("choose");
    setCaptureStage("front");
    setLoadingStep("");
    setErrorDetail(null);
    setCameraReady(false);
    setIsCapturing(false);
    setEbayListing(null);
    setListingError("");
    setListingLoading(false);
    setSelectedUpload(null);
    setShowDetails(false);
  }

  async function capturePhoto() {
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.92 });
      if (!photo?.base64) throw new ScanError("photo", "Photo was captured but contained no image data. Try again.");
      return photo;
    } catch {
      throw new ScanError("photo", "Failed to take the photo. Make sure nothing is blocking the camera.");
    }
  }

  async function capture() {
    if (captureInFlightRef.current) return;
    if (!cameraRef.current) {
      setErrorDetail(makeErrorDetail(new ScanError("camera", "The camera hasn't finished initializing. Wait a moment and try again.")));
      setPhase("error");
      return;
    }
    captureInFlightRef.current = true;
    setIsCapturing(true);
    const scanId = scanImagesRef.current.scanId;
    try {
      setFlashActive(true);
      if (captureStage === "front") {
        setLoadingStep("Capturing the front of the coin...");
        const photo = await capturePhoto();
        const frontImage = await prepareImageForIdentification(photo);
        if (!isCurrentScan(scanIdRef.current, scanId)) return;
        scanImagesRef.current = recordCapture(scanImagesRef.current, "front", frontImage);
        setCaptureStage("back");
        setLoadingStep("");
        return;
      }

      if (!scanImagesRef.current.front) {
        throw new ScanError("photo", "The front photo is missing. Please capture the front side again.");
      }

      setPhase("loading");
      setLoadingStep("Capturing the back of the coin...");
      const photo = await capturePhoto();
      const backImage = await prepareImageForIdentification(photo);
      if (!isCurrentScan(scanIdRef.current, scanId)) return;
      scanImagesRef.current = recordCapture(scanImagesRef.current, "back", backImage);

      const identifyArgs = buildIdentifyArgs(scanImagesRef.current, "camera");
      if (!identifyArgs) {
        throw new ScanError("photo", "Both sides of the coin are needed. Please start the scan again.");
      }
      setLoadingStep("Identifying the coin from both sides...");
      const coinLensResult = await identifyCoin(...identifyArgs);
      const legacyResult = toLegacyScanResult(coinLensResult);
      const { coinData } = legacyResult;

      if (coinData.identifiable !== false) onScanSaved?.();
      if (!isCurrentScan(scanIdRef.current, scanId)) return;

      if (coinData.identifiable === false) {
        setErrorDetail({ icon: "!", title: "Coin Not Recognized", body: coinData.unidentifiable_reason || "CoinLens could not identify this coin.", tip: null });
        setPhase("unidentifiable");
        return;
      }

      setEbayListing(null);
      setListingError("");
      setResult(legacyResult);
      setPhase("result");
    } catch (e) {
      if (!isCurrentScan(scanIdRef.current, scanId)) return;
      setErrorDetail(makeErrorDetail(e));
      setPhase("error");
    } finally {
      if (isCurrentScan(scanIdRef.current, scanId)) {
        captureInFlightRef.current = false;
        setIsCapturing(false);
      }
    }
  }

  useEffect(() => {
    if (!flashActive) return undefined;
    flashAnim.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    animation.start(() => setFlashActive(false));
    return () => animation.stop();
  }, [flashActive, flashAnim]);

  async function uploadPhoto() {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    if (!permissionResult.granted) {
      setErrorDetail(makeErrorDetail(new ScanError(
        "permission",
        permissionResult.canAskAgain
          ? "Photo access is needed to upload a coin image. Tap Upload Photo again to retry."
          : "Photo access is blocked. Enable Photos access for CoinLens in your device settings."
      )));
      setPhase("error");
      return;
    }

    const photo = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      base64: true,
      quality: 0.92,
    });

    if (photo.canceled || !photo.assets?.[0]?.base64) {
      return;
    }

    setSelectedUpload(photo.assets[0]);
  }

  async function startUploadedPhotoScan() {
    if (!selectedUpload?.base64) {
      setErrorDetail(makeErrorDetail(new ScanError("photo", "Choose a photo before starting the scan.")));
      setPhase("error");
      return;
    }

    const scanId = beginScanSession();
    try {
      setPhase("loading");
      setLoadingStep("Identifying the coin...");
      const uploadImage = await prepareImageForIdentification(selectedUpload);
      if (!isCurrentScan(scanIdRef.current, scanId)) return;
      scanImagesRef.current = recordCapture(scanImagesRef.current, "front", uploadImage);
      const coinLensResult = await identifyCoin(...buildIdentifyArgs(scanImagesRef.current, "gallery"));
      const legacyResult = toLegacyScanResult(coinLensResult);
      const { coinData } = legacyResult;

      if (coinData.identifiable !== false) onScanSaved?.();
      if (!isCurrentScan(scanIdRef.current, scanId)) return;

      if (coinData.identifiable === false) {
        setErrorDetail(makeErrorDetail(new ScanError("unidentifiable", coinData.unidentifiable_reason || "Could not identify this coin.")));
        setPhase("unidentifiable");
        return;
      }

      setResult(legacyResult);
      setPhase("result");
    } catch (e) {
      if (!isCurrentScan(scanIdRef.current, scanId)) return;
      setErrorDetail(makeErrorDetail(e));
      setPhase("error");
    }
  }

  if (phase === "choose") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <ScrollView contentContainerStyle={styles.scanChoiceContainer}>
          <GoldCoin size={88} />
          <Text style={styles.pageTitle}>Scan Coin</Text>
          <Text style={styles.pageSubtitle}>Choose how you want to add a coin photo.</Text>

          <View style={styles.scanChoiceOptions}>
            <TouchableOpacity style={styles.scanChoiceCard} onPress={uploadPhoto}>
              <Text style={styles.scanChoiceIcon}>🖼️</Text>
              <View style={styles.cardText}>
                <Text style={styles.cardLabel}>Upload Photo</Text>
                <Text style={styles.cardDesc}>Pick an existing coin photo</Text>
              </View>
              <Text style={styles.cardArrow}>›</Text>
            </TouchableOpacity>

            {selectedUpload ? (
              <View style={styles.uploadPreviewCard}>
                <Text style={styles.resultCardTitle}>Selected Photo</Text>
                <View style={styles.uploadPreviewFrame}>
                  <Image source={{ uri: selectedUpload.uri }} style={styles.uploadPreviewImage} />
                </View>
                <View style={styles.uploadPreviewActions}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={uploadPhoto}>
                    <Text style={styles.secondaryBtnText}>Choose Different</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.previewScanBtn} onPress={startUploadedPhotoScan}>
                    <Text style={styles.previewScanBtnText}>Start Scan</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <TouchableOpacity style={styles.scanChoiceCard} onPress={() => { beginScanSession(); setCaptureStage("front"); setPhase("scanning"); }}>
              <Text style={styles.scanChoiceIcon}>📷</Text>
              <View style={styles.cardText}>
                <Text style={styles.cardLabel}>Take Photo</Text>
                <Text style={styles.cardDesc}>Use your camera for a new scan</Text>
              </View>
              <Text style={styles.cardArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (phase === "scanning" && !permission) return <View style={styles.safeArea} />;

  if (phase === "scanning" && !permission.granted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => setPhase("choose")} />
        <View style={styles.center}>
          <GoldCoin size={80} />
          <Text style={styles.pageTitle}>Camera Access</Text>
          <Text style={styles.pageSubtitle}>Camera access is needed to scan your coins.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "loading") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={startNewScan} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={styles.loadingStep}>{loadingStep}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "error") {
    const ed = errorDetail ?? { icon: "!", title: "Something Went Wrong", body: "An unexpected error occurred.", tip: "Try scanning again.", retryable: true };
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>{ed.icon}</Text>
          <Text style={styles.pageTitle}>{ed.title}</Text>
          <Text style={styles.errorBody}>{ed.body}</Text>
          {ed.tip ? (
            <View style={styles.errorTipBox}>
              <Text style={styles.errorTipLabel}>What to do</Text>
              <Text style={styles.errorTipText}>{ed.tip}</Text>
            </View>
          ) : null}
          {ed.retryable === false ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => { startNewScan(); navigate("home"); }}>
              <Text style={styles.primaryBtnText}>Back to Home</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={startNewScan}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "unidentifiable") {
    const ed = errorDetail ?? { icon: "!", title: "Coin Not Recognized", body: "CoinLens could not identify this coin.", tip: null };
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>{ed.icon}</Text>
          <Text style={styles.pageTitle}>{ed.title}</Text>
          <Text style={styles.errorBody}>{ed.body}</Text>
          <View style={styles.unidentifiableTips}>
            <Text style={styles.tipsTitle}>Tips for a better scan</Text>
            {["Place the coin on a flat, dark surface", "Use good lighting - avoid glare", "Hold the camera steady and close", "Make sure the full coin is in frame"].map((tip, i) => (
              <Text key={i} style={styles.tipItem}>- {tip}</Text>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={startNewScan}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  async function handleCreateEbayListing() {
    if (!result) return;

    setListingLoading(true);
    setListingError("");
    try {
      const { coinData, numistaData, valueEstimate, summary } = result;
      const listing = await generateEbayListing(coinData, numistaData, valueEstimate, summary);
      if (!listing) throw new Error("Unable to generate the listing draft right now.");
      setEbayListing(listing);
    } catch (err) {
      setListingError(err.message || "Unable to create the listing draft.");
    } finally {
      setListingLoading(false);
    }
  }

  if (phase === "result" && result) {
    const { coinData, numistaData, pcgsData, valueEstimate, summary } = result;
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Coin Identified" onBack={startNewScan} />
        <ScrollView contentContainerStyle={styles.resultContainer}>
          <GoldCoin size={72} />
          <Text style={styles.resultCoinName}>
            {coinData.year !== "Unknown" ? `${coinData.year} ` : ""}{coinData.country} {coinData.denomination}
          </Text>

          <ConfidenceMeter value={coinData.confidence} />

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>Identification & Value</Text>
            {[["Country", coinData.country], ["Denomination", coinData.denomination],
              ["Year", coinData.year], ["Mint Mark", coinData.mint_mark],
              ["Grade", coinData.estimated_grade],
              ["Varieties", coinData.varieties]].map(([label, val]) =>
              val && val !== "Unknown" ? (
                <View key={label} style={styles.resultRow}>
                  <Text style={styles.resultLabel}>{label}</Text>
                  <Text style={styles.resultValue}>{val}</Text>
                </View>
              ) : null
            )}

            {valueEstimate ? (
              valueEstimate.low != null && valueEstimate.high != null ? (
                <View style={styles.valueRangeRow}>
                  <View style={styles.valueBox}>
                    <Text style={styles.valueBoxLabel}>Low</Text>
                    <Text style={styles.valueBoxAmount}>${valueEstimate.low.toLocaleString()}</Text>
                  </View>
                  <Text style={styles.valueDash}>-</Text>
                  <View style={styles.valueBox}>
                    <Text style={styles.valueBoxLabel}>High</Text>
                    <Text style={styles.valueBoxAmount}>${valueEstimate.high.toLocaleString()}</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.valueRangeRow}>
                  <View style={styles.valueBox}>
                    <Text style={styles.valueBoxLabel}>{valueEstimate.currency || "USD"}</Text>
                    <Text style={styles.valueBoxAmount}>
                      {valueEstimate.estimated_value != null ? `$${valueEstimate.estimated_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                    </Text>
                  </View>
                </View>
              )
            ) : (
              <Text style={styles.resultSummary}>Value not available for this coin and grade yet.</Text>
            )}
          </View>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowDetails(v => !v)}>
            <Text style={styles.secondaryBtnText}>{showDetails ? "Hide Full Details" : "Show Full Details"}</Text>
          </TouchableOpacity>

          {showDetails && (
            <>
              {Array.isArray(coinData.alternatives) && coinData.alternatives.length > 0 && (
                <View style={styles.resultCard}>
                  <Text style={styles.resultCardTitle}>Could Also Be</Text>
                  {coinData.alternatives.map((alt, i) => (
                    <View key={i} style={styles.altRow}>
                      <View style={styles.altInfo}>
                        <Text style={styles.altCoin}>{alt.coin}</Text>
                        <View style={styles.altBarTrack}>
                          <View style={[styles.altBarFill, { width: `${alt.confidence}%` }]} />
                        </View>
                      </View>
                      <Text style={styles.altPct}>{alt.confidence}%</Text>
                    </View>
                  ))}
                </View>
              )}

              {coinData.mint_errors?.length > 0 && (
                <View style={[styles.resultCard, styles.errorCard]}>
                  <Text style={[styles.resultCardTitle, { color: "#FF6B35" }]}>Mint Errors Detected</Text>
                  {coinData.mint_errors.map((err, i) => (
                    <View key={i} style={styles.errorRow}>
                      <Text style={styles.errorBullet}>-</Text>
                      <Text style={styles.errorText}>{err}</Text>
                    </View>
                  ))}
                </View>
              )}

              {numistaData && !numistaData.error && (
                <View style={styles.resultCard}>
                  <Text style={styles.resultCardTitle}>Numista Specs</Text>
                  {[["Title", numistaData.title], ["Composition", numistaData.composition?.text],
                    ["Weight", numistaData.weight ? `${numistaData.weight}g` : null],
                    ["Diameter", numistaData.size ? `${numistaData.size}mm` : null]].map(([label, val]) =>
                    val ? (
                      <View key={label} style={styles.resultRow}>
                        <Text style={styles.resultLabel}>{label}</Text>
                        <Text style={styles.resultValue}>{val}</Text>
                      </View>
                    ) : null
                  )}
                </View>
              )}

              {valueEstimate && (valueEstimate.source || valueEstimate.condition_assumed || valueEstimate.error_value_note || valueEstimate.reasoning) && (
                <View style={styles.resultCard}>
                  <Text style={styles.resultCardTitle}>Value Details</Text>
                  {valueEstimate.source ? (
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Source</Text>
                      <Text style={styles.resultValue}>{valueEstimate.source}</Text>
                    </View>
                  ) : null}
                  {valueEstimate.condition_assumed ? (
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Condition assumed</Text>
                      <Text style={styles.resultValue}>{valueEstimate.condition_assumed}</Text>
                    </View>
                  ) : null}
                  {valueEstimate.error_value_note ? (
                    <Text style={[styles.resultSummary, { color: "#FF6B35", fontWeight: "700" }]}>{valueEstimate.error_value_note}</Text>
                  ) : null}
                  {valueEstimate.reasoning ? (
                    <Text style={styles.resultSummary}>{valueEstimate.reasoning}</Text>
                  ) : null}
                </View>
              )}

              {pcgsData && !pcgsData.error && (
                <View style={styles.resultCard}>
                  <Text style={styles.resultCardTitle}>PCGS Value</Text>
                  {[["Grade", pcgsData.grade], ["Price", pcgsData.price ? `$${pcgsData.price}` : null],
                    ["Designation", pcgsData.designation]].map(([label, val]) =>
                    val ? (
                      <View key={label} style={styles.resultRow}>
                        <Text style={styles.resultLabel}>{label}</Text>
                        <Text style={styles.resultValue}>{val}</Text>
                      </View>
                    ) : null
                  )}
                </View>
              )}

              {coinData.special_notes ? (
                <View style={styles.resultCard}>
                  <Text style={styles.resultCardTitle}>Notes</Text>
                  <Text style={styles.resultSummary}>{coinData.special_notes}</Text>
                </View>
              ) : null}

              <View style={styles.resultCard}>
                <Text style={styles.resultCardTitle}>Summary</Text>
                <Text style={styles.resultSummary}>{summary}</Text>
              </View>

              {EBAY_LISTING_ENABLED && (
                <View style={styles.resultCard}>
                  <Text style={styles.resultCardTitle}>eBay Listing Draft</Text>
                  {ebayListing ? (
                    <>
                      <Text style={styles.resultSummary}><Text style={styles.resultLabel}>Title: </Text>{ebayListing.title}</Text>
                      {ebayListing.subtitle ? <Text style={styles.resultSummary}><Text style={styles.resultLabel}>Subtitle: </Text>{ebayListing.subtitle}</Text> : null}
                      {ebayListing.description ? <Text style={styles.resultSummary}>{ebayListing.description}</Text> : null}
                      {Array.isArray(ebayListing.item_specifics) && ebayListing.item_specifics.length > 0 ? (
                        <View style={styles.listingSpecList}>
                          {ebayListing.item_specifics.map((spec, i) => (
                            <View key={`${spec.label}-${i}`} style={styles.listingSpecRow}>
                              <Text style={styles.resultLabel}>{spec.label}</Text>
                              <Text style={styles.resultValue}>{spec.value}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {ebayListing.shipping_notes ? <Text style={styles.resultSummary}>Shipping notes: {ebayListing.shipping_notes}</Text> : null}
                    </>
                  ) : (
                    <Text style={styles.resultSummary}>Create a polished eBay title, description, item specifics, and shipping notes for this coin.</Text>
                  )}
                  {listingError ? <Text style={styles.authError}>{listingError}</Text> : null}
                  <TouchableOpacity style={[styles.secondaryBtn, listingLoading && styles.secondaryBtnDisabled]} onPress={handleCreateEbayListing} disabled={listingLoading}>
                    {listingLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.secondaryBtnText}>{ebayListing ? "Refresh eBay Listing" : "Create Ideal eBay Listing"}</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={startNewScan}>
            <Text style={styles.primaryBtnText}>Scan Another</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Scanning view
  const trailHeight = scanAnim.interpolate({
    inputRange: SCAN_TRAIL_INPUT_RANGE,
    outputRange: SCAN_TRAIL_OUTPUT_RANGE,
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Scan Coin" onBack={() => navigate("home")} />
      <View style={styles.scannerOuter}>
        <View style={styles.scannerBoxWrapper}>
          <View style={styles.scannerBox}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setCameraReady(true)} />
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            <View style={styles.scanCrosshair} pointerEvents="none">
              <View style={styles.scanCrosshairH} />
              <View style={styles.scanCrosshairV} />
            </View>
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute", left: 0, right: 0, top: 0, height: SCAN_LINE_HEIGHT,
                transform: [{ translateY: scanAnim.interpolate({
                  inputRange: [0, 1], outputRange: [0, BOX_SIZE - SCAN_LINE_HEIGHT],
                })}],
              }}
            >
              {sweepingDown ? (
                // Moving down: the glow trails behind, above the line. Its
                // bottom edge must stay pinned to the line as height
                // changes, so top tracks -height rather than a fixed value.
                <Animated.View style={{ position: "absolute", left: 0, right: 0, top: Animated.multiply(trailHeight, -1), height: trailHeight }}>
                  <LinearGradient colors={["transparent", "rgba(255,215,0,0.5)"]} style={StyleSheet.absoluteFill} />
                </Animated.View>
              ) : (
                // Moving up: the glow trails behind, below the line.
                <Animated.View style={{ position: "absolute", left: 0, right: 0, top: SCAN_LINE_HEIGHT, height: trailHeight }}>
                  <LinearGradient colors={["rgba(255,215,0,0.5)", "transparent"]} style={StyleSheet.absoluteFill} />
                </Animated.View>
              )}
              <View style={styles.scanLineSolid} />
            </Animated.View>
          </View>
        </View>
        <Text style={styles.scanHint}>{captureMeta.title}</Text>
        <Text style={styles.scanSubHint}>{captureMeta.body}</Text>
        <TouchableOpacity
          onPress={capture}
          disabled={!cameraReady || isCapturing}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={captureStage === "front" ? "Capture front of coin" : "Capture back of coin"}
        >
          <Animated.View style={[
            styles.captureIndicator,
            (!cameraReady || isCapturing) && styles.captureIndicatorDisabled,
            flashActive && {
              transform: [{ scale: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
              backgroundColor: flashAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(255,215,0,0.08)", GOLD] }),
              borderColor: flashAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(255,215,0,0.25)", "#fff6b0"] }),
            },
          ]}>
            <View style={styles.captureButtonInner} />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
