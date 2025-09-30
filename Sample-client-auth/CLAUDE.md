# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

A test webpage for validating Keycloak IDP (Identity Provider) authentication functionality. This application provides a simple interface to test login/logout flows with a Keycloak instance.

## Project Structure

```
idp-logon/
├── index.html       # Main HTML page with authentication UI
├── config.js        # Keycloak configuration settings
├── app.js          # Application logic and Keycloak integration
├── styles.css      # Styling for the test interface
└── .claude/        # Claude Code configuration
```

## Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **IDP**: Keycloak
- **Authentication**: Keycloak JavaScript adapter
- **Protocol**: OpenID Connect / OAuth 2.0

## Configuration

The application connects to Keycloak with these default settings (in `config.js`):
- **Keycloak URL**: `http://localhost:8080`
- **Realm**: `master` (update as needed)
- **Client ID**: `contextflow`
- **Flow**: Authorization Code Flow (standard)

## Development Commands

### Running the Application

1. **Using Python HTTP Server** (Python 3):
   ```bash
   python -m http.server 8000
   ```
   Then navigate to `http://localhost:8000`

2. **Using Node.js HTTP Server**:
   ```bash
   npx http-server -p 8000
   ```
   Then navigate to `http://localhost:8000`

3. **Using Live Server** (VS Code):
   - Right-click on `index.html`
   - Select "Open with Live Server"

### Prerequisites

1. Keycloak must be running on `http://localhost:8080`
2. A client named `contextflow` must be configured in Keycloak
3. The redirect URI `http://localhost:8000` (or your chosen port) must be configured in the Keycloak client settings

## Key Features

- Login/logout functionality with Keycloak
- Display of user information after authentication
- Token information and expiry display
- Automatic token refresh
- Session details visualization
- Debug mode for troubleshooting
- Responsive design for testing on different devices

## Important Files

- **config.js**: Contains all Keycloak configuration - modify realm name and other settings here
- **app.js**: Main application logic - handles authentication flow, token management, and UI updates

## Notes

- The application uses Keycloak JS adapter loaded from CDN
- Tokens are automatically refreshed before expiry (30 seconds threshold)
- Debug information can be toggled to view raw token data
- No backend server required - runs entirely in the browser