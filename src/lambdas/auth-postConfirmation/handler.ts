import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getDb } from '../../shared/db';

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

export const handler = async (event: any) => {
  const { userPoolId, userName, request } = event;
  const { userAttributes } = request;

  const userSub = userAttributes.sub;
  const email = userAttributes.email;
  const name = userAttributes.name ?? userAttributes['custom:name'] ?? null;

  try {
    // Add user to the default "users" Cognito group
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: userName,
        GroupName: 'Users',
      }),
    );
    console.log(`Added ${userName} to "users" group`);
  } catch (err) {
    // Log but don't fail — group assignment failure shouldn't block sign-up
    console.error('Failed to add user to group:', err);
  }

  try {
    // Create user record in RDS
    const db = await getDb();
    await db.query(
      `INSERT INTO users (cognito_sub, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (cognito_sub) DO NOTHING`,
      [userSub, email, name],
    );
    console.log(`Created user record for ${email}`);
  } catch (err) {
    // Log but don't fail — DB insert failure shouldn't block sign-up
    console.error('Failed to create user record:', err);
  }

  // Must return the event unchanged or Cognito treats it as an error
  return event;
};
