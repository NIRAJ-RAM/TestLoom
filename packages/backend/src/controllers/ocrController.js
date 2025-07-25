const ocrService = require('../services/ocrService');
const fs = require('fs').promises;

const getQuestionTypeSummary = (questions) => {
  const summary = {};
  questions.forEach(q => {
    summary[q.questionType] = (summary[q.questionType] || 0) + 1;
  });
  return summary;
};

const calculateOverallConfidence = (questions) => {
  if (questions.length === 0) return 0;
  const totalConfidence = questions.reduce((sum, q) => sum + (q.confidence || 0.5), 0);
  return Math.round((totalConfidence / questions.length) * 100) / 100;
};

const formatQuestionForVerification = (question) => {
  // Only include id, questionText, and options for MCQ
  if (question.options) {
    return {
      id: question.id,
      questionText: question.questionText,
      options: Array.isArray(question.options) ? question.options.map(opt => ({ label: opt.label, text: opt.text })) : []
    };
  }
  // For other types, only id and questionText
  return {
    id: question.id,
    questionText: question.questionText
  };
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded'
      });
    }

    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp', 'image/tiff'];
    if (!allowedMimes.includes(req.file.mimetype)) {
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Please upload JPEG, PNG, BMP, or TIFF images only.'
      });
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (req.file.size > maxSize) {
      await fs.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size allowed is 10MB.'
      });
    }

    const imageBuffer = await fs.readFile(req.file.path);
    
    const rawText = await ocrService.extractTextFromImage(imageBuffer);
    
    const parsedQuestions = ocrService.parseQuestions(rawText);

    await fs.unlink(req.file.path);

    res.json({
      success: true,
      message: 'Image processed successfully',
      data: {
        summary: {
          totalQuestionsFound: parsedQuestions.length,
          questionTypes: getQuestionTypeSummary(parsedQuestions),
          confidence: calculateOverallConfidence(parsedQuestions),
          processingTime: Date.now() - Date.now()
        },
        questions: parsedQuestions.map(question => formatQuestionForVerification(question)),
        metadata: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          fileMimeType: req.file.mimetype,
          processedAt: new Date().toISOString(),
          userId: req.user.id
        },
        rawText: process.env.NODE_ENV === 'development' ? rawText : undefined
      }
    });

  } catch (error) {
    console.error('OCR upload error:', error);
    
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process image',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  uploadImage
};
