# Kleinanzeigen Ultimate Hider - Browser Extension

Browser extension version of the Kleinanzeigen ad hider/filter.

## Features

- Hide ads manually or by keywords
- Track contacted ads
- Dark mode support
- Synced storage across browser sessions

## Installation

### Development / Local Testing

**Chrome:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this `Extension` folder

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` from this folder

**Edge:**
1. Go to `edge://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this `Extension` folder

### Icons Required

Before publishing, add proper icons to the `icons/` folder:
- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels
- `icon128.png` - 128x128 pixels

You can use any image editor or online tool to create these.

## Publishing

### Chrome Web Store
1. Create account at https://chrome.google.com/webstore/devconsole ($5 one-time fee)
2. Zip the Extension folder contents (not the folder itself)
3. Upload and fill in listing details
4. Submit for review

### Firefox Add-ons
1. Create account at https://addons.mozilla.org/developers/
2. Submit extension (free)
3. Faster review process than Chrome

### Edge Add-ons
1. Submit at https://partner.microsoft.com/dashboard/microsoftedge/
2. Uses same manifest format as Chrome

## Differences from Userscript

| Feature | Userscript | Extension |
|---------|-----------|-----------|
| Storage | localStorage | chrome.storage.local |
| Install | Requires Tampermonkey | Direct install |
| Updates | Manual | Auto via store |
| Sync | Per-device only | Can sync across devices |

## Files

- `manifest.json` - Extension configuration
- `content.js` - Main script (runs on kleinanzeigen.de)
- `icons/` - Extension icons
