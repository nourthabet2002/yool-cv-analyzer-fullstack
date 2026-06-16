import streamlit as st
import requests

st.set_page_config(page_title="CV Upload", page_icon="📄")

st.title("CV Upload Interface")
st.write("Upload a PDF CV and send it to the n8n workflow.")

WEBHOOK_URL = "http://localhost:5679/webhook/upload-cv"

uploaded_file = st.file_uploader("Choose a CV (PDF only)", type=["pdf"])

if uploaded_file is not None:
    st.success(f"Selected file: {uploaded_file.name}")

    if st.button("Send CV"):
        files = {
            "data": (uploaded_file.name, uploaded_file.getvalue(), "application/pdf")
        }

        try:
            response = requests.post(WEBHOOK_URL, files=files, timeout=120)

            if response.status_code == 200:
                st.success("CV sent successfully. The workflow has started.")
                st.write("Response from n8n:")
                st.code(response.text)
            else:
                st.error(f"Error {response.status_code}")
                st.code(response.text)

        except Exception as e:
            st.error(f"Request failed: {e}")