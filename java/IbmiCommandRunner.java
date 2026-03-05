import com.ibm.as400.access.AS400;
import com.ibm.as400.access.AS400Message;
import com.ibm.as400.access.CommandCall;

import java.time.Instant;

public class IbmiCommandRunner {
    private static String escape(String value) {
        if (value == null) return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static String now() {
        return Instant.now().toString();
    }

    public static void main(String[] args) {
        if (args.length < 4) {
            System.err.println("Usage: java IbmiCommandRunner <host> <user> <password> <clCommand>");
            System.exit(3);
        }

        String host = args[0];
        String user = args[1];
        String password = args[2];
        String command = args[3];

        AS400 system = null;
        try {
            system = new AS400(host, user, password);
            CommandCall commandCall = new CommandCall(system);
            boolean ok = commandCall.run(command);

            StringBuilder json = new StringBuilder();
            json.append("{");
            json.append("\"ok\":").append(ok ? "true" : "false").append(",");
            json.append("\"command\":\"").append(escape(command)).append("\",");
            json.append("\"messages\":[");

            AS400Message[] messages = commandCall.getMessageList();
            for (int i = 0; i < messages.length; i++) {
                if (i > 0) json.append(",");
                String message = messages[i].getID() + " " + messages[i].getText();
                json.append("\"").append(escape(message)).append("\"");
            }

            json.append("],");
            json.append("\"timestamp\":\"").append(escape(now())).append("\"");
            json.append("}");

            System.out.println(json.toString());
            if (ok) {
                System.exit(0);
            } else {
                System.exit(2);
            }
        } catch (Exception ex) {
            StringBuilder json = new StringBuilder();
            json.append("{");
            json.append("\"ok\":false,");
            json.append("\"command\":\"").append(escape(command)).append("\",");
            json.append("\"messages\":[\"").append(escape(ex.getMessage())).append("\"],");
            json.append("\"timestamp\":\"").append(escape(now())).append("\"");
            json.append("}");

            System.out.println(json.toString());
            System.exit(3);
        } finally {
            if (system != null) {
                try {
                    system.disconnectAllServices();
                } catch (Exception ignored) {
                    // Nothing to do
                }
            }
        }
    }
}

