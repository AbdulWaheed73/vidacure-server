# Vidacure Server - Authentication System

This server implements a secure healthcare authentication system using Criipto OIDC for BankID integration.

## Features

- 🔐 BankID authentication via Criipto OIDC
- 🛡️ JWT-based session management
- 🚫 CSRF protection
- 👥 Role-based access control (patient, doctor, superadmin)
- 📋 Audit logging (ready for implementation)
- 🔒 Secure SSN handling with hashing

## Setup

### 1. Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Criipto OIDC Configuration
CRIIPTO_DOMAIN=https://criiptoiddomain1-test.criipto.id
CRIIPTO_CLIENT_ID=urn:my:application:identifier:37643
CRIIPTO_CLIENT_SECRET=FcrTwSi/LdpsFJZSjbqIbaIy+svliyo3oLxhL2oqsuM=
REDIRECT_URI=http://localhost:3000/api/callback

# JWT and Security
JWT_SECRET=your-super-secret-jwt-key-change-in-production
SSN_HASH_SECRET=your-ssn-hash-secret-change-in-production

# Server Configuration
PORT=3001

# MongoDB Configuration (if needed later)
MONGODB_URI=mongodb+srv://waheed:waheed12345@cluster0.dnuwlq6.mongodb.net/
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## API Endpoints

### Authentication
- `GET /api/login` - Initiate BankID login
- `GET /api/callback` - OAuth callback handler
- `GET /api/me` - Get current user info
- `POST /api/logout` - Logout user

### Admin (Protected)
- `GET /api/admin/users` - Get all users (superadmin only)

### Existing Routes
- `/patient/*` - Patient-related endpoints

## How It Works

1. **Login Flow**: User visits `/api/login` → redirected to BankID → returns to `/api/callback`
2. **User Creation**: After successful authentication, user data is printed to console for you to handle storage
3. **Session Management**: JWT token stored in httpOnly cookie
4. **CSRF Protection**: Frontend must include `X-CSRF-Token` header for non-GET requests

## User Data Structure

After successful authentication, the following user data is printed to console:

```typescript
{
  ssnHash: string;        // Hashed SSN for security
  name: string;           // Full name from BankID
  given_name: string;     // First name
  family_name: string;    // Last name
  role: 'patient';        // Default role (can be changed)
  status: 'active';       // Account status
  createdAt: Date;        // Account creation timestamp
  lastLogin: Date;        // Last login timestamp
}
```

## Security Notes

- **SSN Handling**: SSNs are hashed using HMAC-SHA256 before any processing
- **JWT Tokens**: Stored in httpOnly cookies for XSS protection
- **CSRF Protection**: Implemented but simplified (you can enhance later)
- **Role-Based Access**: Middleware ready for protecting routes

## Next Steps

1. **Database Integration**: Use the printed user data to store in your existing schemas
2. **Enhanced CSRF**: Implement full CSRF token validation with MongoDB storage
3. **Audit Logging**: Connect the audit system to your database
4. **User Management**: Implement user role changes and status updates

## Testing

1. Visit `http://localhost:3001`
2. Click "Login with BankID"
3. Complete BankID authentication
4. Check console for user data
5. Use `/api/me` to verify authentication status
