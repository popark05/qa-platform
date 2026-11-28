package com.popark05.qafixture;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    int padding = (int) (24 * getResources().getDisplayMetrics().density);
    layout.setPadding(padding, padding, padding, padding);

    Button continueButton = new Button(this);
    continueButton.setText("Continue");
    continueButton.setContentDescription("Continue");
    layout.addView(continueButton, new LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

    EditText email = new EditText(this);
    email.setSingleLine(true);
    email.setHint("Email");
    email.setContentDescription("Email");
    email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
    layout.addView(email, new LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

    TextView welcome = new TextView(this);
    welcome.setText("Welcome");
    welcome.setContentDescription("Welcome");
    welcome.setTextSize(24);
    welcome.setVisibility(View.GONE);
    welcome.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    layout.addView(welcome, new LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

    continueButton.setOnClickListener(view -> welcome.setVisibility(View.VISIBLE));
    setContentView(layout);
  }
}
