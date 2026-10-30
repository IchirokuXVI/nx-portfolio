package app.velista;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The app's own plugins are registered before super, which builds the bridge and
        // reads the list then (velista plan 0177).
        registerPlugin(VelistaGooglePlugin.class);
        super.onCreate(savedInstanceState);
        // Edge to edge on every API level, as Capacitor 8's SystemBars documentation asks
        // for `insetsHandling: 'native'`. After super and not before it: super switches
        // from the launch theme to the one without an action bar, and enabling edge to
        // edge first builds the window under the launch theme, action bar included.
        EdgeToEdge.enable(this);
    }
}
