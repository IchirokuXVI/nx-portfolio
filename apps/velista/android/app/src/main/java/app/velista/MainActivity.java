package app.velista;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Before super, as Capacitor 8's SystemBars documentation prescribes, so the
        // window is edge to edge on every API level and not only where Android 15 forces it.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
