/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

// Shared secret resolution for the Zeus Java helpers.
//
// Passing a password as a positional CLI argument makes it visible in the OS
// process list (Task Manager / `ps`). To avoid that, the Node layer passes a
// sentinel value in place of the password and provides the real secret through
// the ZEUS_JV_PASSWORD environment variable of the child process. This class
// resolves the sentinel back to the actual secret.
//
// Backward compatible: if the value is not the sentinel it is returned as-is,
// so an explicitly passed password (legacy behaviour) still works.
public final class ZeusSecrets {
    public static final String SENTINEL = "@ZEUS_SECRET_ENV@";
    public static final String ENV_VAR = "ZEUS_JV_PASSWORD";

    private ZeusSecrets() {
    }

    public static String resolve(String value) {
        if (SENTINEL.equals(value)) {
            String fromEnv = System.getenv(ENV_VAR);
            if (fromEnv != null) {
                return fromEnv;
            }
        }
        return value;
    }
}
