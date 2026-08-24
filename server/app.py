import os

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
NUMISTA_API_KEY = os.environ.get("NUMISTA_API_KEY", "")
PCGS_BEARER_TOKEN = os.environ.get("PCGS_BEARER_TOKEN", "")
SHEETDB_URL = os.environ.get("SHEETDB_URL", "")
ADMIN_CODE = os.environ.get("ADMIN_CODE", "")

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
NUMISTA_COINS_URL = "https://api.numista.com/api/v3/coins"
PCGS_PRICE_URL = "https://api.pcgs.com/publicapi/priceguide/getpricedata/{pcgs_number}"

REQUEST_TIMEOUT = 60

app = Flask(__name__)
CORS(app)


def proxy_response(upstream_response):
    return Response(
        upstream_response.content,
        status=upstream_response.status_code,
        content_type=upstream_response.headers.get("Content-Type", "application/json"),
    )


@app.route("/api/openai/chat", methods=["POST"])
def openai_chat():
    if not OPENAI_API_KEY:
        return jsonify({"error": {"message": "Server is missing OPENAI_API_KEY."}}), 500

    payload = request.get_json(force=True, silent=True) or {}
    upstream = requests.post(
        OPENAI_CHAT_URL,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        },
        json=payload,
        timeout=REQUEST_TIMEOUT,
    )
    return proxy_response(upstream)


@app.route("/api/numista-specs", methods=["GET"])
def numista_specs():
    if not NUMISTA_API_KEY:
        return jsonify({"items": []})

    upstream = requests.get(
        NUMISTA_COINS_URL,
        params={"q": request.args.get("q", ""), "count": request.args.get("count", 1)},
        headers={"Numista-API-Key": NUMISTA_API_KEY},
        timeout=REQUEST_TIMEOUT,
    )
    return proxy_response(upstream)


@app.route("/api/pcgs-value/<pcgs_number>", methods=["GET"])
def pcgs_value(pcgs_number):
    if not PCGS_BEARER_TOKEN:
        return jsonify(None)

    upstream = requests.get(
        PCGS_PRICE_URL.format(pcgs_number=pcgs_number),
        headers={"Authorization": f"bearer {PCGS_BEARER_TOKEN}"},
        timeout=REQUEST_TIMEOUT,
    )
    return proxy_response(upstream)


@app.route("/api/log-scan", methods=["POST"])
def log_scan():
    if not SHEETDB_URL:
        return jsonify({"skipped": True})

    payload = request.get_json(force=True, silent=True) or {}
    upstream = requests.post(SHEETDB_URL, json=payload, timeout=REQUEST_TIMEOUT)
    return proxy_response(upstream)


@app.route("/api/scans", methods=["GET"])
def get_scans():
    if not SHEETDB_URL:
        return jsonify([])

    upstream = requests.get(SHEETDB_URL, timeout=REQUEST_TIMEOUT)
    return proxy_response(upstream)


@app.route("/api/verify-admin-code", methods=["POST"])
def verify_admin_code():
    payload = request.get_json(force=True, silent=True) or {}
    submitted = str(payload.get("code", "")).strip()
    valid = bool(ADMIN_CODE) and submitted == ADMIN_CODE
    return jsonify({"valid": valid})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
